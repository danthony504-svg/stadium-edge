import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  prepareForwardForecast,
  type ForecastInput,
} from "./lib/ncaafForecastJournal.js";
import { forecastInputFromArchive } from "./lib/ncaafLiveInputAdapter.js";
import { verifyOvertimeSupportArchive } from "./lib/ncaafOvertimeTransfer.js";
async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw Error("journal_input_required");
  const raw = await readFile(file, "utf8");
  if (Buffer.byteLength(raw) > 25_000_000)
    throw Error("journal_input_too_large");
  let input = JSON.parse(raw) as ForecastInput;
  const option = (key: string) => {
    const i = process.argv.indexOf(key);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const liveKey = option("--live-input-key");
  if (!liveKey && !process.argv.includes("--execute")) {
    const record = prepareForwardForecast(input, new Date().toISOString());
    console.log(
      JSON.stringify({
        planOnly: true,
        eventId: record.target.eventId,
        markets: record.markets.length,
        automaticUnlock: false,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw Error("journal_database_missing");
  const requireDb = createRequire(
    resolve(
      process.env.NCAAF_REPO_ROOT ?? "/opt/render/project/src",
      "lib/db/package.json",
    ),
  );
  const { Client } = requireDb("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  try {
    await db.query(
      process.argv.includes("--execute") ? "BEGIN" : "BEGIN READ ONLY",
    );
    const check = await db.query(
      "SELECT current_database() AS name, clock_timestamp() AS now",
    );
    if (check.rows[0].name !== "stadium_edge_production")
      throw Error("journal_unexpected_database");
    if (liveKey) {
      if (!/^research:ncaaf:live-inputs:/.test(liveKey))
        throw Error("journal_invalid_live_key");
      const live = await db.query(
        "SELECT value FROM public.app_kv WHERE key=$1",
        [liveKey],
      );
      const recent = await db.query(
        "SELECT key,value FROM public.app_kv WHERE key LIKE 'research:ncaaf:injuries:%' ORDER BY key DESC LIMIT 1",
      );
      const injuryRow = recent.rows[0];
      if (
        !live.rows[0]?.value ||
        !injuryRow ||
        injuryRow.value.researchOnly !== true ||
        injuryRow.value.absentTeamStatus !== "unknown"
      )
        throw Error("journal_live_archive_missing");
      input = forecastInputFromArchive(
        live.rows[0].value,
        option("--event-id") ?? "",
        JSON.parse(raw).games,
        {
          key: injuryRow.key,
          observedAt: injuryRow.value.observedAt,
          sha256: injuryRow.value.sha256,
          rawResponse: injuryRow.value.rawResponse,
          absentTeamStatus: "unknown",
        },
        option("--ruleset") ?? "",
        new Date(check.rows[0].now).toISOString(),
      );
    }
    const injury = await db.query(
      "SELECT value FROM public.app_kv WHERE key=$1",
      [input.injuryEvidence?.key],
    );
    const evidence = injury.rows[0]?.value;
    if (
      !evidence ||
      evidence.researchOnly !== true ||
      evidence.sha256 !== input.injuryEvidence.sha256 ||
      evidence.rawResponse !== input.injuryEvidence.rawResponse ||
      evidence.observedAt !== input.injuryEvidence.observedAt ||
      evidence.absentTeamStatus !== "unknown"
    )
      throw Error("journal_injury_archive_mismatch");
    if (input.overtimeSupport) {
      const supportRow = (
        await db.query("SELECT value FROM public.app_kv WHERE key=$1", [
          input.overtimeSupport.sourceKey,
        ])
      ).rows[0];
      if (!supportRow) throw Error("journal_overtime_archive_missing");
      verifyOvertimeSupportArchive(input.overtimeSupport, supportRow.value);
    }
    const record = prepareForwardForecast(
      input,
      new Date(check.rows[0].now).toISOString(),
    );
    if (!process.argv.includes("--execute")) {
      await db.query("ROLLBACK");
      console.log(
        JSON.stringify({
          planOnly: true,
          eventId: record.target.eventId,
          markets: record.markets.length,
          automaticUnlock: false,
        }),
      );
      return;
    }
    const key = `research:ncaaf:forecast:${record.modelVersion}:${record.target.season}:${record.target.eventId}`;
    // DB clock guards the final INSERT, after computation; first forecast is immutable.
    const result = await db.query(
      "INSERT INTO public.app_kv(key,value) SELECT $1, $2::jsonb || jsonb_build_object('recordedAt',clock_timestamp()) WHERE clock_timestamp() < $3::timestamptz ON CONFLICT(key) DO NOTHING RETURNING key",
      [key, JSON.stringify(record), record.target.kickoff],
    );
    if (!result.rowCount)
      throw Error("journal_started_event_or_existing_forecast");
    // Recheck immediately before commit as the computation/DB write can cross kickoff.
    const time = await db.query(
      "SELECT clock_timestamp() < $1::timestamptz AS pregame",
      [record.target.kickoff],
    );
    if (!time.rows[0].pregame)
      throw Error("journal_event_started_before_commit");
    await db.query("COMMIT");
    console.log(
      JSON.stringify({
        saved: true,
        eventId: record.target.eventId,
        markets: record.markets.length,
        automaticUnlock: false,
      }),
    );
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}
main().catch((e) => {
  const m = e instanceof Error ? e.message : "";
  console.error(/^journal_[a-z_]+$/.test(m) ? m : "journal_failed_no_unlock");
  process.exitCode = 1;
});
