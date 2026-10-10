import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import {
  coachSlateGetMayStartJob,
  coachSlateNeedsRefresh,
  hasUsableCoachSlateSnapshot,
} from "../lib/coachSlateGetPolicy.js";
import { runCoachSlateJob, SLATE_PRE_ANALYSIS_MAX_MS } from "../lib/coachSlateJobs.js";
import { getCoachPrecomputedSlate } from "../lib/coachSlateStore.js";
import {
  nearestSlateParlaySize,
  SLATE_INSTANT_SERVE_MAX_MS,
  SLATE_PARLAY_SIZES,
  snapshotForClient,
} from "../lib/coachSlateTypes.js";
import { userHasCoachPremiumAccess } from "../lib/subscriptionAccess.js";
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

function clerkUserId(req: Request): string | null {
  try {
    return getAuth(req)?.userId ?? null;
  } catch {
    return null;
  }
}

/** Instant precomputed Coach slate — optional ?legs=5&sport=mlb for exact ticket. */
router.get("/coach/slate", async (req, res): Promise<void> => {
  const legs = parseLegsQuery(req.query.legs);
  const sport = parseSportQuery(req.query.sport);
  try {
    const row = await getCoachPrecomputedSlate();
    const userId = clerkUserId(req);
    // Fail closed on auth errors — never unlock premium from a thrown lookup.
    let premiumUnlocked = false;
    try {
      premiumUnlocked = await userHasCoachPremiumAccess(userId);
    } catch (err) {
      logger.warn({ err }, "coach slate: premium lookup failed; treating as locked");
      premiumUnlocked = false;
    }

    // READ-ONLY: never start runCoachSlateJob / simulations from GET.
    // Cold-miss / stale rows return refreshing=true; cron warms the snapshot.
    const hasUsableSnapshot = hasUsableCoachSlateSnapshot(row);
    const needsRefresh = coachSlateNeedsRefresh(row);
    if (coachSlateGetMayStartJob(row)) {
      // Unreachable by design — guard documents the invariant for reviewers.
      logger.error("coach slate GET attempted to start a generation job");
    }

    let clientSnapshot = null;
    if (row.snapshot && hasUsableSnapshot) {
      try {
        clientSnapshot = snapshotForClient(row.snapshot, {
          legs,
          sport,
          premiumUnlocked,
        });
        // Never send an unlocked snapshot if redaction somehow failed open.
        if (!premiumUnlocked && clientSnapshot?.boardScan?.picks?.length) {
          const leak = clientSnapshot.boardScan.picks.some(
            (p) =>
              (p.game && p.game !== "••••••") ||
              (p.pick && p.pick !== "••••••") ||
              (typeof p.odds === "number" && p.odds !== 0),
          );
          if (leak) {
            logger.error(
              { path: "coach-slate", outcome: "redact_leak" },
              "coach slate: refusing to serve identity-bearing locked snapshot",
            );
            clientSnapshot = null;
          }
        }
      } catch (err) {
        logger.error({ err }, "coach slate: snapshotForClient failed");
        clientSnapshot = null;
      }
    }

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
      premiumUnlocked,
    });
  } catch (err) {
    // Last-resort degrade: 200 + empty slate so free Coach UI does not hard-fail.
    logger.error({ err }, "coach slate GET failed");
    res.status(200).json({
      snapshot: null,
      fresh: false,
      instantServe: false,
      refreshing: true,
      computedAt: null,
      deepSimComplete: false,
      maxAgeMs: SLATE_PRE_ANALYSIS_MAX_MS,
      instantServeMaxMs: SLATE_INSTANT_SERVE_MAX_MS,
      supportedLegCounts: [...SLATE_PARLAY_SIZES],
      resolvedLegCount: legs ? nearestSlateParlaySize(legs) : undefined,
      resolvedSport: sport ?? undefined,
      activeSports: [],
      premiumUnlocked: false,
      degraded: true,
    });
  }
});

/**
 * Legacy HTTP cron entry.
 * Production generation runs on the Render Cron Job worker (coachSlateWorker).
 * Set COACH_SLATE_RUN_ON_WEB=1 only for emergency override — still holds the
 * advisory lock but can OOM the web dyno (see run #1405).
 */
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
  if (process.env.COACH_SLATE_RUN_ON_WEB !== "1") {
    res.status(410).json({
      ok: false,
      error: "slate cron moved to Render Cron Job worker",
      code: "use_render_cron_worker",
    });
    return;
  }
  try {
    const result = await runCoachSlateJob();
    // Fail closed: job errors and empty bodies must not look like a healthy cron to GH Actions.
    if (!result?.ok || result.summary?.reason === "error") {
      res.status(500).json({
        error: "slate refresh failed",
        ok: false,
        summary: result?.summary ?? null,
      });
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    logger.error({ err }, "coach slate cron failed");
    res.status(500).json({ error: "cron failed", ok: false });
  }
});

export default router;
