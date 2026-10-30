/** One bounded NCAAB research run in a separate OS process. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { attemptNcaabResearchFreeze } from "./lib/ncaabAdjustedModelStore.js";
import { recordNcaabAdjustedForecasts } from "./lib/ncaabForecastJournal.js";
import { runNcaabValidationPipeline } from "./lib/ncaabValidationPipeline.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const allowed = new Set([
  "ncaab-capture-live-inputs.mjs",
  "ncaab-prepare-development.mjs",
]);

async function runCollector(name: string, args: string[]) {
  if (!allowed.has(name)) throw Error("ncaab_pipeline_unknown_collector");
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=256",
        resolve(repoRoot, "scripts", name),
        ...args,
        "--execute",
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, NCAAB_REPO_ROOT: repoRoot },
      },
    );
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("ncaab_pipeline_collector_timeout"));
    }, 8 * 60_000);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(Error("ncaab_pipeline_collector_start_failed"));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun();
      else reject(Error("ncaab_pipeline_collector_failed"));
    });
  });
}

async function main() {
  if (process.env.NCAAB_RESEARCH_PIPELINE_ENABLED !== "true") return;
  if (!process.env.DATABASE_URL) throw Error("ncaab_pipeline_missing_environment");
  const requireDb = createRequire(resolve(repoRoot, "lib/db/package.json")),
    { Client } = requireDb("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
  });
  await db.connect();
  try {
    const fetchOutcome = async (eventId: string, season: number) => {
      const requestStartedAt = new Date().toISOString();
      const response = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=${eventId}`,
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      if (!response.ok) return null;
      const rawResponse = await response.text();
      const receivedAt = new Date().toISOString();
      if (Buffer.byteLength(rawResponse) > 8_000_000) return null;
      const { ncaabSummaryFinal } = await import(
        new URL(
          "../../../scripts/ncaab-bind-final-summary.mjs",
          import.meta.url,
        ).href
      );
      try {
        const archive = ncaabSummaryFinal(
          rawResponse,
          eventId,
          season,
          requestStartedAt,
          receivedAt,
        );
        return archive.games.length === 1
          ? { outcome: archive.games[0], source: archive }
          : null;
      } catch {
        return null;
      }
    };
    await runNcaabValidationPipeline({
      db,
      collectionEnabled: Boolean(process.env.ODDS_API_KEY?.trim()),
      runCollector,
      fetchOutcome,
      attemptFreeze: () => attemptNcaabResearchFreeze(db, repoRoot),
      recordJournal: () => recordNcaabAdjustedForecasts(db),
    });
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "ncaab_research_worker_failed");
  process.exitCode = 1;
});
