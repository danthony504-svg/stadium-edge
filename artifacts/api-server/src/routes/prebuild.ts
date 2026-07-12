import { Router, type IRouter } from "express";
import { runPrebuildJobs } from "../lib/prebuildJobs";
import { runCoachSlateJob } from "../lib/coachSlateJobs.js";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Cron entry point for cache pre-warming. NOT Clerk-protected — guarded by a
// shared secret header so only the Scheduled Deployment (which knows the key)
// can trigger it. Reuses NOTIFY_CRON_KEY when a dedicated PREBUILD_CRON_KEY
// isn't set, so a single scheduled secret can drive both cron endpoints.
router.post("/prebuild/cron", async (req, res) => {
  const key = process.env.PREBUILD_CRON_KEY || process.env.NOTIFY_CRON_KEY;
  if (!key) {
    res.status(503).json({ error: "cron not configured" });
    return;
  }
  if (req.get("x-cron-key") !== key) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const result = await runPrebuildJobs();
    // Odds/props caches are warm — immediately refresh the 24/7 Coach slate so
    // mobile always loads picks that reflect the latest posted board.
    void runCoachSlateJob().catch((err) => {
      logger.warn({ err }, "coach slate refresh after prebuild failed");
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "prebuild cron failed");
    res.status(500).json({ error: "cron failed" });
  }
});

export default router;
