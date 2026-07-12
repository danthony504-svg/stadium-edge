import { Router, type IRouter } from "express";
import {
  isCoachSlateJobRunning,
  runCoachSlateJob,
  scheduleCoachSlateRefresh,
  SLATE_PRE_ANALYSIS_MAX_MS,
} from "../lib/coachSlateJobs.js";
import { getCoachPrecomputedSlate } from "../lib/coachSlateStore.js";
import {
  nearestSlateParlaySize,
  SLATE_INSTANT_SERVE_MAX_MS,
  SLATE_PARLAY_SIZES,
  snapshotForClient,
} from "../lib/coachSlateTypes.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function parseLegsQuery(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 3 ? n : undefined;
}

function parseSportQuery(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();
  return s && s !== "global" && s !== "all" ? s : null;
}

/** Instant precomputed Coach slate — optional ?legs=5&sport=mlb for exact ticket. */
router.get("/coach/slate", async (req, res): Promise<void> => {
  try {
    const legs = parseLegsQuery(req.query.legs);
    const sport = parseSportQuery(req.query.sport);
    const row = await getCoachPrecomputedSlate();

    const hasUsableSnapshot = row.snapshot && (row.fresh || row.instantServe);
    const needsRefresh = !row.fresh && (!row.snapshot || row.instantServe);

    if (needsRefresh && !isCoachSlateJobRunning()) {
      scheduleCoachSlateRefresh(hasUsableSnapshot ? "stale-while-revalidate" : "cold-miss");
    }

    const clientSnapshot =
      row.snapshot && hasUsableSnapshot
        ? snapshotForClient(row.snapshot, { legs, sport })
        : null;

    res.json({
      snapshot: clientSnapshot,
      fresh: row.fresh,
      instantServe: row.instantServe,
      refreshing: needsRefresh,
      computedAt: row.computedAt,
      deepSimComplete: row.deepSimComplete,
      maxAgeMs: SLATE_PRE_ANALYSIS_MAX_MS,
      instantServeMaxMs: SLATE_INSTANT_SERVE_MAX_MS,
      supportedLegCounts: [...SLATE_PARLAY_SIZES],
      resolvedLegCount: legs ? nearestSlateParlaySize(legs) : undefined,
      resolvedSport: sport ?? undefined,
      activeSports: row.snapshot?.activeSports ?? [],
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
