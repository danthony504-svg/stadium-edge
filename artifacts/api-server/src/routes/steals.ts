import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports";
import { fetchStealsWithMeta, persistSteals, gradePending, getRecord, getGradedHistory } from "../lib/liveSteals";
import { seasonStatsFromGraded } from "../lib/liveStealsCore";

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

const EMPTY_SCAN_META = {
  booksScanned: 0,
  marketsChecked: 0,
  longshotsAnalyzed: 0,
  stealsFound: 0,
  sportCounts: {} as Record<string, number>,
  totalOpportunities: 0,
};

router.get("/sports/live-steals", async (req, res): Promise<void> => {
  try {
    const [record, history, scan] = await Promise.all([
      getRecord(),
      getGradedHistory(),
      fetchStealsWithMeta().catch((scanErr) => {
        req.log.warn({ err: scanErr }, "live-steals scan failed — returning empty pool");
        return null;
      }),
    ]);
    const seasonStats = seasonStatsFromGraded(history);

    let steals: Awaited<ReturnType<typeof fetchStealsWithMeta>>["steals"] = [];
    let meta = EMPTY_SCAN_META;
    let almostQualified: Awaited<ReturnType<typeof fetchStealsWithMeta>>["almostQualified"] = [];
    let feedDegraded = scan == null;

    if (scan) {
      steals = scan.steals;
      meta = scan.meta;
      almostQualified = scan.almostQualified;
      feedDegraded = meta.marketsChecked <= 0;
      await persistSteals(steals);
    }

    if (Date.now() - lastGradeAt > GRADE_THROTTLE_MS) {
      lastGradeAt = Date.now();
      gradePending().catch(() => {});
    }

    res.json({ steals, record, history, meta, almostQualified, seasonStats, feedDegraded });
  } catch (err) {
    req.log.error({ err }, "live-steals route failed");
    res.json({
      steals: [],
      almostQualified: [],
      meta: EMPTY_SCAN_META,
      record: { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 },
      history: [],
      seasonStats: { roiPct: null, avgOdds: null },
      feedDegraded: true,
    });
  }
});

export default router;
