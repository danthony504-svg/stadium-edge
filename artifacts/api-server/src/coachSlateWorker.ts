/**
 * Render Cron Job entrypoint — runs Coach slate pre-analysis off the web dyno.
 *
 * Env (required in production):
 *   DATABASE_URL
 *   COACH_SLATE_API_BASE=https://stadium-edge.onrender.com/api
 *   COACH_SLATE_WORKER=1
 *   COACH_SLATE_SIM_MODE=inprocess
 *
 * Start command:
 *   node --enable-source-maps ./dist/coachSlateWorker.mjs
 */
process.env.COACH_SLATE_WORKER = process.env.COACH_SLATE_WORKER || "1";
process.env.COACH_SLATE_SIM_MODE = process.env.COACH_SLATE_SIM_MODE || "inprocess";

import { runCoachSlateJob } from "./lib/coachSlateJobs.js";
import { coachSlateApiBase, coachSlateSimsInProcess } from "./lib/coachSlateLoopback.js";
import { logger } from "./lib/logger.js";
import { rssMb } from "./lib/coachSlatePhaseMetrics.js";

async function main(): Promise<void> {
  const apiBase = coachSlateApiBase();
  if (/127\.0\.0\.1|localhost/i.test(apiBase)) {
    logger.error(
      { apiBase },
      "coach slate worker: COACH_SLATE_API_BASE must point at the production web API (not localhost)",
    );
    process.exit(2);
  }
  if (!coachSlateSimsInProcess()) {
    logger.error("coach slate worker: sims must run in-process (set COACH_SLATE_WORKER=1)");
    process.exit(2);
  }

  logger.info(
    { apiBase, simsInProcess: true, rssMb: rssMb() },
    "coach slate worker starting",
  );

  const result = await runCoachSlateJob();
  logger.info({ result }, "coach slate worker finished");

  if (!result.ok) {
    process.exit(1);
  }
  // lock-held / unchanged-fresh / success are all exit 0
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "coach slate worker crashed");
  process.exit(1);
});
