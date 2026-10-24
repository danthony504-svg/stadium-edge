/** One bounded research run in a separate OS process. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { runNcaafResearchLifecycle } from "./lib/ncaafResearchLifecycle.js";
import { runNcaafValidationPipeline } from "./lib/ncaafValidationPipeline.js";
import { recordOvertimeTransferForecasts } from "./lib/ncaafOvertimeTransferJournal.js";
const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const allowed = new Set([
  "ncaaf-capture-history.mjs",
  "ncaaf-capture-live-inputs.mjs",
  "ncaaf-capture-injuries.mjs",
  "ncaaf-conference-availability.mjs",
  "ncaaf-context-dataset.mjs",
  "ncaaf-prepare-development.mjs",
  "ncaaf-capture-usage.mjs",
  "ncaaf-repair-team-history.mjs",
]);
async function runCollector(name: string, args: string[]) {
  if (!allowed.has(name)) throw Error("pipeline_unknown_collector");
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        resolve(repoRoot, "scripts", name),
        ...args,
        "--execute",
      ],
      { stdio: ["ignore", "ignore", "ignore"], env: process.env },
    );
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("pipeline_collector_timeout"));
    }, 8 * 60_000);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(Error("pipeline_collector_start_failed"));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun();
      else reject(Error("pipeline_collector_failed"));
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    child.once("exit", () => process.off("SIGTERM", stop));
  });
}
async function main() {
  if (process.env.NCAAF_RESEARCH_PIPELINE_ENABLED !== "true") return;
  if (!process.env.DATABASE_URL) throw Error("pipeline_missing_environment");
  const requireDb = createRequire(resolve(repoRoot, "lib/db/package.json")),
    { Client } = requireDb("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  try {
    const fetchOutcome = async (eventId: string, season: number) => {
      const requestStartedAt = new Date().toISOString();
      const response = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${eventId}`,
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      if (!response.ok) return null;
      const rawResponse = await response.text(),
        receivedAt = new Date().toISOString();
      if (Buffer.byteLength(rawResponse) > 8_000_000) return null;
      const { summaryHistory } = await import(
        new URL(
          "../../../scripts/ncaaf-repair-team-history.mjs",
          import.meta.url,
        ).href
      );
      const archive = summaryHistory(
        rawResponse,
        eventId,
        season,
        requestStartedAt,
        receivedAt,
      );
      return archive.games.length === 1
        ? { outcome: archive.games[0], source: archive }
        : null;
    };
    const result = await runNcaafResearchLifecycle({
      db,
      settle: () =>
        runNcaafValidationPipeline({
          db,
          runCollector,
          fetchOutcome,
          settlementOnly: true,
        }),
      label: () => runCollector("ncaaf-context-dataset.mjs", ["--labels-only"]),
      prepareDevelopment: () =>
        runCollector("ncaaf-prepare-development.mjs", []),
      transfer:
        process.env.NCAAF_RESEARCH_OT_TRANSFER_ENABLED === "true"
          ? () => recordOvertimeTransferForecasts(db, true)
          : undefined,
      collect: () =>
        runNcaafValidationPipeline({
          db,
          runCollector,
          fetchOutcome,
        }),
    });
    if (result.state === "partial_failure") process.exitCode = 1;
    console.log(
      JSON.stringify({
        component: "ncaaf-research-pipeline",
        state: result.state,
        releaseEligible: false,
      }),
    );
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error("ncaaf-research-pipeline failed; no release change");
  process.exitCode = 1;
});
