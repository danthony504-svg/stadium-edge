import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports";
import { fetchSteals, persistSteals, gradePending, getRecord, getGradedHistory } from "../lib/liveSteals";

// GET /api/sports/live-steals — the mobile "+500 Steals" feed: live/upcoming
// longshot bets (American odds +500..+30000) carrying a REAL cross-book no-vig
// edge, plus the auto-graded W/L track record of the app's OWN steal picks.
// Honesty: every steal/edge is real or omitted (see lib/liveSteals.ts); the
// record settles only against real game/stat results (shared gradeLegs).
const router: IRouter = Router();

router.use("/sports/live-steals", rateLimit({ windowMs: 60_000, max: 60, name: "live-steals" }));

// Grade-on-GET is throttled so a burst of opens doesn't hammer ESPN/StatMuse;
// the cron (runLiveStealsJob) is the primary grader, this is just a backstop.
let lastGradeAt = 0;
const GRADE_THROTTLE_MS = 5 * 60 * 1000;

router.get("/sports/live-steals", async (_req, res): Promise<void> => {
  try {
    const steals = await fetchSteals();
    // Capture freshly-seen steals (once) so they enter the graded ledger.
    await persistSteals(steals);
    // Best-effort, throttled grading backstop.
    if (Date.now() - lastGradeAt > GRADE_THROTTLE_MS) {
      lastGradeAt = Date.now();
      gradePending().catch(() => {});
    }
    const [record, history] = await Promise.all([getRecord(), getGradedHistory()]);
    res.json({ steals, record, history });
  } catch {
    res.status(502).json({ error: "could not load steals" });
  }
});

export default router;
