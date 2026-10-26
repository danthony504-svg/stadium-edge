/** One bounded NCAAB research run in a separate OS process. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { runNcaabValidationPipeline } from "./lib/ncaabValidationPipeline.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const allowed = new Set(["ncaab-capture-live-inputs.mjs"]);

async function runCollector(name: string, args: string[]) {
  if (!allowed.has(name)) throw Error("ncaab_pipeline_unknown_collector");
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        resolve(repoRoot, "scripts", name),
        ...args,
        "--execute",
      ],
      { stdio: ["ignore", "ignore", "pipe"], env: process.env },
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
    query_timeout: 15000,
  });
  await db.connect();
  try {
    await runNcaabValidationPipeline({
      db,
      collectionEnabled: Boolean(process.env.ODDS_API_KEY?.trim()),
      runCollector,
    });
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "ncaab_research_worker_failed");
  process.exitCode = 1;
});
