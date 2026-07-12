import { Router, type IRouter } from "express";
import { runCoachSlateJob, SLATE_PRE_ANALYSIS_MAX_MS } from "../lib/coachSlateJobs.js";
import { getCoachPrecomputedSlate } from "../lib/coachSlateStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/** Instant precomputed Coach slate for mobile — no auth required (public odds-derived data). */
router.get("/coach/slate", async (_req, res): Promise<void> => {
  try {
    const row = await getCoachPrecomputedSlate();
    res.json({
      snapshot: row.snapshot,
      fresh: row.fresh,
      computedAt: row.computedAt,
      deepSimComplete: row.deepSimComplete,
      maxAgeMs: SLATE_PRE_ANALYSIS_MAX_MS,
    });
  } catch (err) {
    logger.error({ err }, "coach slate GET failed");
    res.status(500).json({ error: "failed to load coach slate" });
  }
});

/** Cron entry — scheduled deployment POSTs here every few minutes. */
router.post("/coach/slate/cron", async (req, res): Promise<void> => {
  const key = process.env.COACH_SLATE_CRON_KEY || process.env.PREBUILD_CRON_KEY || process.env.NOTIFY_CRON_KEY;
  if (!key) {
    res.status(503).json({ error: "cron not configured" });
    return;
  }
  if (req.get("x-cron-key") !== key) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const result = await runCoachSlateJob();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "coach slate cron failed");
    res.status(500).json({ error: "cron failed" });
  }
});

export default router;
