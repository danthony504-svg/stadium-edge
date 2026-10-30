/**
 * NCAAB research validation pipeline — separate from NCAAF.
 * Captures prospective live inputs and settles saved research forecasts only.
 * Never enables Coach or marks releaseEligible.
 */
import { createHash } from "node:crypto";
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import {
  scoreNcaabRecordedForecast,
  type NcaabResearchForecast,
  type NcaabSettledOutcome,
} from "./ncaabForecastSettlement.js";

export const NCAAB_MIN_INDEPENDENT_GAMES = 500;
export const NCAAB_MIN_SEASONS = 2;
export const NCAAB_RESEARCH_PREFIX = "research:ncaab:";

const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

export type NcaabPipelineDeps = {
  db: ResearchDb;
  settlementOnly?: boolean;
  collectionEnabled?: boolean;
  runCollector: (name: string, args: string[]) => Promise<void>;
  fetchOutcome: (
    eventId: string,
    season: number,
  ) => Promise<{ outcome: NcaabSettledOutcome; source: unknown } | null>;
  attemptFreeze?: () => Promise<{ state: string; modelSha256?: string | null }>;
  recordJournal?: () => Promise<{
    state: string;
    recorded?: number;
    withheld?: number;
  }>;
};

export function ncaabResearchSlot(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw Error("ncaab_pipeline_invalid_clock");
  const day = new Date(now);
  let hour = [22, 18, 14, 2].find((h) => h <= now.getUTCHours());
  if (hour === undefined) {
    day.setUTCDate(day.getUTCDate() - 1);
    hour = 22;
  }
  day.setUTCHours(hour, 0, 0, 0);
  return day.toISOString();
}

export async function runNcaabValidationPipeline({
  db,
  runCollector,
  fetchOutcome,
  attemptFreeze,
  recordJournal,
  settlementOnly = false,
  collectionEnabled = true,
}: NcaabPipelineDeps) {
  const clock = async () =>
    new Date(
      (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
    ).toISOString();
  const get = async (key: string) =>
    (await db.query("SELECT value FROM public.app_kv WHERE key=$1", [key]))
      .rows[0]?.value;
  const put = async (key: string, value: unknown) => {
    await db.query(
      "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
      [key, JSON.stringify(value)],
    );
  };

  const check = await db.query("SELECT current_database() AS name");
  if (check.rows[0].name !== "stadium_edge_production")
    throw Error("ncaab_pipeline_unexpected_database");

  const acquired = (
    await db.query("SELECT pg_try_advisory_lock(64234,20261026) AS acquired")
  ).rows[0].acquired;
  if (!acquired) return { state: "skipped_overlap", releaseEligible: false };

  let slot = "";
  let slotKey = "";
  let state: Record<string, unknown> = {};
  try {
    const blockers: Record<string, number> = {};
    const fail = (reason: string) => {
      blockers[reason] = (blockers[reason] ?? 0) + 1;
    };

    // Settlement maintenance — independent of collection slot completion.
    let settlementsRecorded = 0;
    let unsettledInBatch = 0;
    const settlementErrors: Record<string, number> = {};
    const settlementFail = (reason: string) => {
      settlementErrors[reason] = (settlementErrors[reason] ?? 0) + 1;
      fail(reason);
    };
    const settlementNow = await clock();
    const previousSettlement = await get("research:ncaab:settlement-check:latest");
    const previousAttempt = Date.parse(previousSettlement?.startedAt ?? "");
    if (
      !Number.isFinite(previousAttempt) ||
      Date.parse(settlementNow) - previousAttempt >= 30 * 60000
    ) {
      await put("research:ncaab:settlement-check:latest", {
        startedAt: settlementNow,
        state: "running",
        researchOnly: true,
        releaseEligible: false,
      });
      try {
        const pending = (
          await db.query(
            `SELECT f.key,f.value FROM public.app_kv f
             LEFT JOIN public.app_kv s ON s.key=replace(f.key,'research:ncaab:forecast:','research:ncaab:settlement:')
             WHERE f.key LIKE 'research:ncaab:forecast:%' AND s.key IS NULL
               AND (f.value->'target'->>'kickoff')::timestamptz <= clock_timestamp()-interval '4 hours'
             ORDER BY f.value->'target'->>'kickoff',f.key LIMIT 64`,
          )
        ).rows;
        const nowMs = Date.parse(await clock());
        for (const row of pending) {
          try {
            const t = row.value?.target;
            if (
              !t ||
              !/^\d+$/.test(t.eventId) ||
              !Number.isSafeInteger(t.season) ||
              !Number.isFinite(Date.parse(t.kickoff))
            )
              throw Error("invalid_saved_forecast");
            if (nowMs < Date.parse(t.kickoff) + 4 * 3600000) {
              unsettledInBatch++;
              continue;
            }
            const final = await fetchOutcome(t.eventId, t.season);
            if (!final) {
              unsettledInBatch++;
              continue;
            }
            const metrics = scoreNcaabRecordedForecast(
              row.value as NcaabResearchForecast,
              final.outcome,
            );
            const key = row.key.replace(
              "research:ncaab:forecast:",
              "research:ncaab:settlement:",
            );
            const value = {
              version: 1,
              sport: "ncaab",
              researchOnly: true,
              forecastKey: row.key,
              forecastSha256: digest(row.value),
              observedAt: await clock(),
              outcome: final.outcome,
              source: final.source,
              metrics,
              releaseEligible: false,
              coachEnabled: false,
            };
            const written = await db.query(
              "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING RETURNING key",
              [key, JSON.stringify(value)],
            );
            if (written.rowCount) settlementsRecorded++;
          } catch {
            settlementFail("settlement_unavailable_or_invalid");
          }
        }
        await put("research:ncaab:settlement-check:latest", {
          startedAt: settlementNow,
          finishedAt: await clock(),
          state: "processed",
          pendingInBatch: pending.length,
          settlementsRecorded,
          unsettledInBatch,
          batchLimit: 64,
          blockers: { ...settlementErrors },
          researchOnly: true,
          releaseEligible: false,
          coachEnabled: false,
        });
      } catch {
        settlementFail("settlement_check_or_storage_failed");
        await put("research:ncaab:settlement-check:latest", {
          startedAt: settlementNow,
          finishedAt: await clock(),
          state: "failed",
          researchOnly: true,
          releaseEligible: false,
          coachEnabled: false,
          blockers: { ...settlementErrors },
        });
      }
    }

    if (settlementOnly) {
      return {
        state: "settlement_check_completed",
        settlementsRecorded,
        unsettledInBatch,
        releaseEligible: false,
        coachEnabled: false,
      };
    }

    slot = ncaabResearchSlot(new Date(await clock()));
    slotKey = `research:ncaab:pipeline:slot:${slot}`;
    const prior = await get(slotKey);
    const maintenanceKey = `research:ncaab:pipeline:maintenance:${slot}`;
    const MAINTENANCE_CADENCE_MS = 30 * 60000;

    /** Prepare / freeze / journal against saved archives — never charges odds. */
    const runMaintenanceStages = async (opts: {
      paidCollectionSkipped: boolean;
      oddsAttempted: boolean;
      attempts: number;
      resultState: string;
    }) => {
      state = {
        version: 1,
        sport: "ncaab",
        researchOnly: true,
        slot,
        startedAt: await clock(),
        oddsAttempted: opts.oddsAttempted,
        paidCollectionSkipped: opts.paidCollectionSkipped,
        state: "running",
        attempts: opts.attempts,
        releaseEligible: false,
        coachEnabled: false,
        phase: "development",
      };
      // Do not rewrite a completed paid slot to running — latest tracks phase.
      if (!(prior?.state === "processed" && prior?.finishedAt)) {
        await put(slotKey, {
          ...prior,
          ...state,
          state: "running",
        });
      }
      await put("research:ncaab:pipeline:latest", state);

      try {
        await runCollector("ncaab-prepare-development.mjs", []);
      } catch {
        fail("ncaab_development_prepare_failed");
      }
      const development = await get("research:ncaab:development-dataset:latest");
      state.developmentState = development?.state ?? null;
      state.authenticatedDevelopmentGames =
        development?.authenticatedDevelopmentGames ?? 0;
      state.featureCompleteDevelopmentGames =
        development?.featureCompleteGames ?? 0;
      state.developmentManifestSha256 = development?.manifestSha256 ?? null;

      state.phase = "freeze";
      await put("research:ncaab:pipeline:latest", state);
      if (attemptFreeze) {
        try {
          const freeze = await attemptFreeze();
          state.freezeState = freeze.state;
          // Honest null until a real fit writes a candidate hash.
          state.freezeModelSha256 = freeze.modelSha256 ?? null;
          if (!freeze.modelSha256)
            fail(freeze.state || "waiting_for_frozen_ncaab_candidate");
        } catch {
          fail("ncaab_freeze_attempt_failed");
        }
      }

      state.phase = "journal";
      await put("research:ncaab:pipeline:latest", state);
      const frozen = await get("research:ncaab:adjusted-model:latest");
      if (!frozen?.modelSha256) {
        fail("waiting_for_frozen_ncaab_candidate");
      } else if (recordJournal) {
        try {
          const journal = await recordJournal();
          state.journalState = journal.state;
          state.journalRecorded = journal.recorded ?? 0;
          state.journalWithheld = journal.withheld ?? 0;
          if (journal.state !== "processed") fail(journal.state);
        } catch {
          fail("ncaab_forecast_journal_failed");
        }
      } else {
        fail("ncaab_forecast_journal_not_wired");
      }

      const finishedAt = await clock();
      const latest: Record<string, unknown> = {
        ...state,
        state: opts.resultState,
        finishedAt,
        phase: "done",
        blockers,
        releaseEligible: false,
        coachEnabled: false,
      };
      // Slot row stays first-write completed for paid odds; maintenance updates latest + cadence.
      if (prior?.state === "processed" && prior?.finishedAt) {
        await put(slotKey, {
          ...prior,
          lastMaintenanceAt: finishedAt,
          lastMaintenanceState: opts.resultState,
          blockers,
          freezeState: state.freezeState,
          freezeModelSha256: state.freezeModelSha256 ?? null,
          authenticatedDevelopmentGames: state.authenticatedDevelopmentGames,
          featureCompleteDevelopmentGames: state.featureCompleteDevelopmentGames,
        });
      } else {
        await put(slotKey, {
          ...latest,
          state: "processed",
        });
      }
      await put(maintenanceKey, {
        startedAt: state.startedAt,
        finishedAt,
        state: opts.resultState,
        researchOnly: true,
        releaseEligible: false,
      });
      await put("research:ncaab:pipeline:latest", latest);
      return latest;
    };

    // Completed paid slot: skip Odds API, still run bounded archive maintenance.
    if (prior?.finishedAt && prior.state === "processed") {
      const previousMaintenance = await get(maintenanceKey);
      const maintenanceStarted = Date.parse(
        previousMaintenance?.startedAt ?? "",
      );
      const nowMs = Date.parse(await clock());
      if (
        Number.isFinite(maintenanceStarted) &&
        nowMs >= maintenanceStarted &&
        nowMs - maintenanceStarted < MAINTENANCE_CADENCE_MS
      ) {
        return {
          state: "skipped_completed_slot",
          slot,
          freeEvidenceRefresh: false,
          maintenanceSkippedCadence: true,
          blockers,
          settlementsRecorded,
          unsettledInBatch,
          releaseEligible: false,
          coachEnabled: false,
          note: "ncaab_v1_no_mid_slot_paid_odds_refresh",
        };
      }
      const latest = await runMaintenanceStages({
        paidCollectionSkipped: true,
        oddsAttempted: prior.oddsAttempted === true,
        attempts: prior.attempts ?? 1,
        resultState: "skipped_completed_slot",
      });
      return {
        state: "skipped_completed_slot",
        slot,
        freeEvidenceRefresh: false,
        maintenanceRan: true,
        blockers,
        settlementsRecorded,
        unsettledInBatch,
        authenticatedDevelopmentGames: latest.authenticatedDevelopmentGames,
        featureCompleteDevelopmentGames: latest.featureCompleteDevelopmentGames,
        freezeState: latest.freezeState,
        freezeModelSha256: latest.freezeModelSha256 ?? null,
        releaseEligible: false,
        coachEnabled: false,
        note: "ncaab_v1_no_mid_slot_paid_odds_refresh",
      };
    }

    if (!collectionEnabled) {
      return {
        state: "skipped_missing_odds_credentials",
        settlementsRecorded,
        unsettledInBatch,
        releaseEligible: false,
        coachEnabled: false,
      };
    }

    if (prior && (prior.attempts ?? 1) >= 3) {
      return {
        state: "skipped_exhausted_slot",
        slot,
        releaseEligible: false,
        coachEnabled: false,
      };
    }
    if (
      prior &&
      Date.parse(await clock()) -
        Date.parse(prior.finishedAt ?? prior.startedAt) <
        5 * 60000
    ) {
      return {
        state: "skipped_retry_backoff",
        slot,
        releaseEligible: false,
        coachEnabled: false,
      };
    }

    state = {
      version: 1,
      sport: "ncaab",
      researchOnly: true,
      slot,
      startedAt: await clock(),
      oddsAttempted: prior?.oddsAttempted === true,
      state: "running",
      attempts: (prior?.attempts ?? 0) + 1,
      releaseEligible: false,
      coachEnabled: false,
    };
    await put(slotKey, state);
    await put("research:ncaab:pipeline:latest", state);

    if (!state.oddsAttempted) {
      state.oddsAttempted = true;
      state.phase = "quotes";
      await put(slotKey, state);
      await put("research:ncaab:pipeline:latest", state);
      try {
        await runCollector("ncaab-capture-live-inputs.mjs", [
          "--capture-slot",
          slot,
        ]);
      } catch {
        fail("live_input_capture_failed");
      }
    }

    const latest = await runMaintenanceStages({
      paidCollectionSkipped: false,
      oddsAttempted: state.oddsAttempted === true,
      attempts: state.attempts as number,
      resultState: "processed",
    });
    return {
      state: "processed",
      slot,
      blockers,
      settlementsRecorded,
      unsettledInBatch,
      authenticatedDevelopmentGames: latest.authenticatedDevelopmentGames,
      featureCompleteDevelopmentGames: latest.featureCompleteDevelopmentGames,
      freezeState: latest.freezeState,
      freezeModelSha256: latest.freezeModelSha256 ?? null,
      releaseEligible: false,
      coachEnabled: false,
    };
  } catch (err) {
    const finishedAt = await clock();
    const reason =
      err instanceof Error ? err.message : "ncaab_pipeline_failed";
    const failed = {
      ...state,
      state: "failed",
      finishedAt,
      reason,
      releaseEligible: false,
      coachEnabled: false,
    };
    if (slotKey) {
      const existing = await get(slotKey);
      if (existing?.state === "processed" && existing?.finishedAt) {
        // Never demote a completed paid-odds slot: maintenance failures must
        // not reopen attempts or clear oddsAttempted for another Odds charge.
        await put(slotKey, {
          ...existing,
          lastMaintenanceAt: finishedAt,
          lastMaintenanceState: "failed",
          lastMaintenanceReason: reason,
        });
      } else {
        await put(slotKey, failed);
      }
    }
    await put("research:ncaab:pipeline:latest", failed);
    throw err;
  } finally {
    await db.query("SELECT pg_advisory_unlock(64234,20261026)");
  }
}
