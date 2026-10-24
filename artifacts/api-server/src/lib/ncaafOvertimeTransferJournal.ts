/** Opt-in forward journal for a separately versioned OT transfer experiment. */
import { createHash } from "node:crypto";
import type { ResearchDb } from "./ncaafValidationPipeline.js";
import { forecastInputFromArchive } from "./ncaafLiveInputAdapter.js";
import { prepareForwardForecast } from "./ncaafForecastJournal.js";
import {
  overtimeSupportFromArchive,
  OT_TRANSFER_MODEL_VERSION,
} from "./ncaafOvertimeTransfer.js";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function recordOvertimeTransferForecasts(
  db: ResearchDb,
  execute = false,
) {
  if (
    (await db.query("SELECT current_database() AS name")).rows[0].name !==
    "stadium_edge_production"
  )
    throw Error("transfer_unexpected_database");
  const acquired = (
    await db.query("SELECT pg_try_advisory_lock(64233,20261030) AS acquired")
  ).rows[0].acquired;
  if (!acquired) return { state: "skipped_overlap", releaseEligible: false };
  try {
    const latest = async (prefix: string) =>
      (
        await db.query(
          "SELECT key,value FROM public.app_kv WHERE key LIKE $1 ORDER BY key DESC LIMIT 1",
          [`${prefix}%`],
        )
      ).rows[0];
    const [history, supportRow, live, injury] = await Promise.all([
      latest("research:ncaaf:history-summary:2026:"),
      latest("research:ncaaf:history-summary:2025:"),
      latest("research:ncaaf:live-inputs:"),
      latest("research:ncaaf:injuries:"),
    ]);
    if (
      !history ||
      !supportRow ||
      !live ||
      !injury ||
      injury.value.researchOnly !== true ||
      injury.value.absentTeamStatus !== "unknown"
    )
      throw Error("transfer_archives_missing");
    const support = overtimeSupportFromArchive(
      supportRow.key,
      supportRow.value,
    );
    const matches = live.value.matched;
    if (!Array.isArray(matches) || matches.length > 128)
      throw Error("transfer_target_budget");
    const errors: Record<string, number> = {};
    let eligible = 0,
      recorded = 0,
      existing = 0,
      withheld = 0;
    for (const match of matches) {
      try {
        const now = new Date(
          (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
        ).toISOString();
        for (const time of [
          live.value.odds?.receivedAt,
          injury.value.observedAt,
        ]) {
          const age = Date.parse(now) - Date.parse(time);
          if (!Number.isFinite(age) || age < 0 || age > 6 * 3600000)
            throw Error("journal_stale_transfer_archive");
        }
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
          "ncaa-football-season-2026-unverified",
          now,
        );
        input.overtimeSupport = support;
        Object.assign(input, {
          liveSourceEvidence: { key: live.key, sha256: digest(live.value) },
          historySourceEvidence: {
            key: history.key,
            sha256: digest(history.value),
          },
        });
        const record = prepareForwardForecast(input, now);
        if (record.modelVersion !== OT_TRANSFER_MODEL_VERSION)
          throw Error("journal_transfer_model_mismatch");
        eligible++;
        if (!execute) continue;
        const key = `research:ncaaf:forecast:${record.modelVersion}:2026:${record.target.eventId}`;
        const result = await db.query(
          "INSERT INTO public.app_kv(key,value) SELECT $1,$2::jsonb || jsonb_build_object('recordedAt',clock_timestamp()) WHERE clock_timestamp() < $3::timestamptz ON CONFLICT(key) DO NOTHING RETURNING key",
          [key, JSON.stringify(record), record.target.kickoff],
        );
        if (result.rowCount) recorded++;
        else if (
          (
            await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
              key,
            ])
          ).rows.length
        )
          existing++;
        else throw Error("journal_event_started_before_forecast_write");
      } catch (error) {
        withheld++;
        const message = error instanceof Error ? error.message : "";
        const reason = /^journal_[a-z_]+$/.test(message)
          ? message
          : "journal_invalid_transfer_inputs";
        errors[reason] = (errors[reason] ?? 0) + 1;
      }
    }
    const result = {
      state: "processed",
      planOnly: !execute,
      modelVersion: OT_TRANSFER_MODEL_VERSION,
      matchedEvents: matches.length,
      eligible,
      recorded,
      existing,
      withheld,
      blockers: errors,
      supportOvertimeGames: support.games.length,
      sourceKeys: [history.key, supportRow.key, live.key, injury.key],
      researchOnly: true,
      transferCalibrationVerified: false,
      releaseEligible: false,
      automaticUnlock: false,
      finishedAt: new Date(
        (await db.query("SELECT clock_timestamp() AS now")).rows[0].now,
      ).toISOString(),
    };
    if (execute)
      await db.query(
        "INSERT INTO public.app_kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
        ["research:ncaaf:ot-transfer:latest", JSON.stringify(result)],
      );
    return result;
  } finally {
    await db.query("SELECT pg_advisory_unlock(64233,20261030)");
  }
}
