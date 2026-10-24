/** Research automation only. This module cannot lift a production gate. */
import { createHash } from "node:crypto";
import {
  forecastInputFromArchive,
  type LiveInputArchive,
} from "./ncaafLiveInputAdapter.js";
import {
  prepareForwardForecast,
  scoreRecordedForecast,
} from "./ncaafForecastJournal.js";
import type { TimedGame } from "./ncaafFullGameBacktest.js";
export interface ResearchDb {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export type PipelineDeps = {
  db: ResearchDb;
  runCollector: (name: string, args: string[]) => Promise<void>;
  fetchOutcome: (
    eventId: string,
    season: number,
  ) => Promise<{ outcome: TimedGame; source: unknown } | null>;
};
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function researchSlot(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw Error("pipeline_invalid_clock");
  const day = new Date(now);
  let hour = [22, 18, 14, 2].find((h) => h <= now.getUTCHours());
  if (hour === undefined) {
    day.setUTCDate(day.getUTCDate() - 1);
    hour = 22;
  }
  day.setUTCHours(hour, 0, 0, 0);
  return day.toISOString();
}
export async function runNcaafValidationPipeline({
  db,
  runCollector,
  fetchOutcome,
}: PipelineDeps) {
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
  const latest = async (prefix: string) =>
    (
      await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE $1 ORDER BY key DESC LIMIT 1",
        [`${prefix}%`],
      )
    ).rows[0];
  const check = await db.query("SELECT current_database() AS name");
  if (check.rows[0].name !== "stadium_edge_production")
    throw Error("pipeline_unexpected_database");
  const acquired = (
    await db.query("SELECT pg_try_advisory_lock(64233,20261028) AS acquired")
  ).rows[0].acquired;
  if (!acquired) return { state: "skipped_overlap", releaseEligible: false };
  let slotKey = "",
    slot = "",
    state: any;
  try {
    // Settlement has its own bounded retry clock, independent of collection slots.
    // Claim the attempt before provider calls so failures cannot trigger a storm.
    const errors: Record<string, number> = {};
    const fail = (reason: string) => {
      errors[reason] = (errors[reason] ?? 0) + 1;
    };
    let scored = 0,
      unsettled = 0;
    const settlementNow = await clock();
    const previousSettlement = await get(
      "research:ncaaf:settlement-check:latest",
    );
    const previousAttempt = Date.parse(previousSettlement?.startedAt ?? "");
    if (
      !Number.isFinite(previousAttempt) ||
      Date.parse(settlementNow) - previousAttempt >= 30 * 60000
    ) {
      await put("research:ncaaf:settlement-check:latest", {
        startedAt: settlementNow,
        state: "running",
        releaseEligible: false,
      });
      // Resolve only queued forecasts whose source has actually declared a final.
      const pending = await db.query(
        "SELECT f.key,f.value FROM public.app_kv f LEFT JOIN public.app_kv s ON s.key=replace(f.key,'research:ncaaf:forecast:','research:ncaaf:settlement:') WHERE f.key LIKE 'research:ncaaf:forecast:%' AND s.key IS NULL AND (f.value->'target'->>'kickoff')::timestamptz <= clock_timestamp()-interval '4 hours' ORDER BY f.value->'target'->>'kickoff',f.key LIMIT 64",
      );
      const now = Date.parse(await clock());
      for (const row of pending.rows) {
        try {
          const t = row.value.target;
          if (
            !t ||
            !/^\d+$/.test(t.eventId) ||
            !Number.isFinite(Date.parse(t.kickoff))
          )
            throw Error("invalid_saved_forecast");
          if (now < Date.parse(t.kickoff) + 4 * 3600000) {
            unsettled++;
            continue;
          }
          const final = await fetchOutcome(t.eventId, t.season);
          if (!final) {
            unsettled++;
            continue;
          }
          const metrics = scoreRecordedForecast(row.value, final.outcome);
          const key = row.key.replace(
            "research:ncaaf:forecast:",
            "research:ncaaf:settlement:",
          );
          const value = {
            version: 1,
            researchOnly: true,
            forecastKey: row.key,
            forecastSha256: digest(row.value),
            observedAt: await clock(),
            outcome: final.outcome,
            source: final.source,
            metrics,
            releaseEligible: false,
          };
          const written = await db.query(
            "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING RETURNING key",
            [key, JSON.stringify(value)],
          );
          if (written.rowCount) scored++;
        } catch {
          fail("settlement_unavailable_or_invalid");
        }
      }
      await put("research:ncaaf:settlement-check:latest", {
        startedAt: settlementNow,
        finishedAt: await clock(),
        state: "processed",
        settlementsRecorded: scored,
        unsettledInBatch: unsettled,
        batchLimit: 64,
        blockers: { ...errors },
        releaseEligible: false,
      });
    }
    slot = researchSlot(new Date(await clock()));
    slotKey = `research:ncaaf:pipeline:slot:${slot}`;
    const prior = await get(slotKey);
    if (prior?.finishedAt && prior.state === "processed")
      return {
        state: "skipped_completed_slot",
        slot,
        settlementsRecorded: scored,
        unsettledInBatch: unsettled,
        releaseEligible: false,
      };
    if (prior && (prior.attempts ?? 1) >= 3)
      return { state: "skipped_exhausted_slot", slot, releaseEligible: false };
    if (
      prior &&
      Date.parse(await clock()) -
        Date.parse(prior.finishedAt ?? prior.startedAt) <
        5 * 60000
    )
      return { state: "skipped_retry_backoff", slot, releaseEligible: false };
    // Mark the charged request BEFORE invoking it. A crash cannot silently retry it.
    state = {
      version: 1,
      researchOnly: true,
      slot,
      startedAt: await clock(),
      oddsAttempted: prior?.oddsAttempted === true,
      state: "running",
      attempts: (prior?.attempts ?? 0) + 1,
      releaseEligible: false,
    };
    await put(slotKey, state);
    await put("research:ncaaf:pipeline:latest", state);
    state.phase = "injuries";
    await put("research:ncaaf:pipeline:latest", state);
    await runCollector("ncaaf-capture-injuries.mjs", []);
    if (!state.oddsAttempted) {
      state.oddsAttempted = true;
      state.phase = "quotes";
      await put(slotKey, state);
      await put("research:ncaaf:pipeline:latest", state);
      await runCollector("ncaaf-capture-live-inputs.mjs", []);
    }
    // Supplementary research evidence must not block existing collection/scoring.
    state.phase = "conference_availability";
    await put("research:ncaaf:pipeline:latest", state);
    try {
      await runCollector("ncaaf-conference-availability.mjs", [
        "--capture-slot",
        slot,
      ]);
    } catch {
      fail("conference_availability_capture_failed");
    }
    let live = await latest("research:ncaaf:live-inputs:");
    if (!live || Date.parse(live.value.odds?.receivedAt) < Date.parse(slot))
      fail("current_slot_quote_archive_missing");
    const matches: LiveInputArchive["matched"] = live?.value.matched ?? [];
    if (matches.length > 128) throw Error("pipeline_target_budget");
    state.phase = "history";
    await put("research:ncaaf:pipeline:latest", state);
    const seasons = [...new Set(matches.map((g) => g.target.season))];
    if (seasons.length > 2) throw Error("pipeline_season_budget");
    for (const season of seasons) {
      if (
        !Number.isSafeInteger(season) ||
        season < 2021 ||
        season > new Date(await clock()).getUTCFullYear()
      )
        throw Error("pipeline_invalid_season");
      if (!(await latest(`research:ncaaf:history-summary:${season}:`)))
        await runCollector("ncaaf-capture-history.mjs", [
          "--season",
          String(season),
        ]);
      await runCollector("ncaaf-repair-team-history.mjs", [
        "--season",
        String(season),
        "--capture-slot",
        slot,
      ]);
    }
    try {
      await runCollector("ncaaf-context-dataset.mjs", []);
    } catch {
      fail("context_dataset_assembly_failed");
    }
    // Reload after collection; input timestamps are compared to a fresh DB clock.
    live = await latest("research:ncaaf:live-inputs:");
    const injury = await latest("research:ncaaf:injuries:");
    state.phase = "forecasts";
    await put("research:ncaaf:pipeline:latest", state);
    let recorded = 0,
      existing = 0,
      withheld = 0;
    const inputsBySeason = new Map<number, any>();
    for (const match of matches) {
      const season = match.target.season;
      let history = inputsBySeason.get(season);
      if (!history) {
        history = await latest(`research:ncaaf:history-summary:${season}:`);
        inputsBySeason.set(season, history);
      }
      try {
        if (!history || !injury || !live)
          throw Error("journal_pipeline_input_missing");
        const now = await clock();
        if (
          Date.parse(injury.value.observedAt) > Date.parse(now) ||
          Date.parse(now) - Date.parse(injury.value.observedAt) > 6 * 3600000
        )
          throw Error("journal_stale_injury_archive");
        if (
          injury.value.researchOnly !== true ||
          injury.value.absentTeamStatus !== "unknown"
        )
          throw Error("journal_invalid_injury_archive");
        const input = forecastInputFromArchive(
          live.value,
          match.target.eventId,
          history.value.games,
          {
            key: injury.key,
            observedAt: injury.value.observedAt,
            sha256: injury.value.sha256,
            rawResponse: injury.value.rawResponse,
            absentTeamStatus: "unknown",
          },
          `ncaa-football-season-${season}-unverified`,
          now,
        );
        // Raw archives already exist durably: store authenticated references, not one
        // copy of the entire slate response in every event forecast.
        Object.assign(input, {
          liveSourceEvidence: { key: live.key, sha256: digest(live.value) },
          historySourceEvidence: {
            key: history.key,
            sha256: digest(history.value),
          },
        });
        const record = prepareForwardForecast(input, now);
        const key = `research:ncaaf:forecast:${record.modelVersion}:${season}:${match.target.eventId}`;
        const result = await db.query(
          "INSERT INTO public.app_kv(key,value) SELECT $1,$2::jsonb || jsonb_build_object('recordedAt',clock_timestamp()) WHERE clock_timestamp() < $3::timestamptz ON CONFLICT(key) DO NOTHING RETURNING key",
          [key, JSON.stringify(record), record.target.kickoff],
        );
        if (result.rowCount) recorded++;
        else if (await get(key)) existing++;
        else fail("event_started_before_forecast_write");
      } catch (e) {
        withheld++;
        const message = e instanceof Error ? e.message : "";
        fail(
          /^journal_[a-z_]+$/.test(message)
            ? message
            : "invalid_forecast_inputs",
        );
      }
    }
    if (!matches.length) fail("no_matched_pregame_events");
    const settlements = (
      await db.query(
        "SELECT value FROM public.app_kv WHERE key LIKE 'research:ncaaf:settlement:%' ORDER BY key DESC LIMIT 5000",
      )
    ).rows.map((r) => r.value);
    const report = calibrationReport(settlements);
    const historyCounts = [...inputsBySeason].map(([season, h]) => ({
      season,
      games: h?.value.games?.length ?? 0,
      overtimeGames:
        h?.value.games?.filter((g: any) => g.overtime === true).length ?? 0,
    }));
    const result = {
      ...state,
      phase: "done",
      state: "processed",
      finishedAt: await clock(),
      matchedEvents: matches.length,
      forecastsRecorded: recorded,
      forecastsAlreadyPresent: existing,
      forecastsWithheld: withheld,
      settlementsRecorded: scored,
      unsettledInBatch: unsettled,
      batchLimit: 64,
      history: historyCounts,
      blockers: errors,
      calibration: report,
      releaseEligible: false,
      releaseEvaluation: "not_run_no_verified_independent_holdout",
      releaseBlockers: [
        "independent_multiseason_holdout_unverified",
        "source_and_ruleset_review_required",
        "injury_opponent_venue_calibration_unverified",
        "human_signoff_required",
      ],
    };
    await put(slotKey, result);
    await put("research:ncaaf:pipeline:latest", result);
    return result;
  } catch (e) {
    if (!slotKey) {
      // A settlement failure is not a collection failure. Preserve the last
      // collection report and the pre-call attempt timestamp for retry throttling.
      const attempt = await get("research:ncaaf:settlement-check:latest");
      await put("research:ncaaf:settlement-check:latest", {
        ...attempt,
        state: "failed",
        finishedAt: await clock(),
        reason: "settlement_check_or_storage_failed",
        releaseEligible: false,
      });
      throw e;
    }
    const failed = {
      ...state,
      slot,
      state: "failed",
      finishedAt: await clock(),
      reason: "pipeline_collection_or_storage_failed",
      releaseEligible: false,
    };
    if (slotKey) await put(slotKey, failed);
    await put("research:ncaaf:pipeline:latest", failed);
    throw e;
  } finally {
    await db.query("SELECT pg_advisory_unlock(64233,20261028)");
  }
}
export function calibrationReport(settlements: any[]) {
  const groups = new Map<
      string,
      {
        modelVersion: string;
        season: number;
        bookmaker: string;
        market: string;
        games: number;
        pushes: number;
        modelBrier: number;
        marketBrier: number;
      }
    >(),
    events = new Set<string>(),
    votes = new Set<string>();
  for (const s of settlements) {
    if (!s?.researchOnly || !Array.isArray(s.metrics)) continue;
    for (const m of s.metrics) {
      const key = JSON.stringify([
        m.modelVersion,
        m.season,
        m.bookmaker,
        m.market,
      ]);
      const vote = JSON.stringify([key, m.eventId]);
      if (votes.has(vote)) continue;
      votes.add(vote);
      let g = groups.get(key);
      if (!g) {
        g = {
          modelVersion: m.modelVersion,
          season: m.season,
          bookmaker: m.bookmaker,
          market: m.market,
          games: 0,
          pushes: 0,
          modelBrier: 0,
          marketBrier: 0,
        };
        groups.set(key, g);
      }
      if (m.result === "push") {
        g.pushes++;
        continue;
      }
      if (
        ![m.modelBrier, m.marketBrier].every(
          (v) =>
            typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
        )
      )
        continue;
      g.games++;
      g.modelBrier += m.modelBrier;
      g.marketBrier += m.marketBrier;
      events.add(`${m.season}:${m.eventId}`);
    }
  }
  return {
    researchOnly: true,
    uniqueSettledEvents: events.size,
    cohorts: [...groups.values()].map((g) => ({
      ...g,
      modelBrier: g.games ? g.modelBrier / g.games : null,
      marketBrier: g.games ? g.marketBrier / g.games : null,
    })),
    releaseEligible: false,
  };
}
