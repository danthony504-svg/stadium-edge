import { logger } from "./logger.js";
import { runPrebuildJobs } from "./prebuildJobs.js";
import { buildServerCompactParlayContext } from "./coachSlateContext.js";
import { enrichServerPropSims, runServerBoardScan } from "./coachSlateBoardScan.js";
import { getCoachPrecomputedSlate, persistCoachPrecomputedSlate } from "./coachSlateStore.js";
import {
  computeSlateFingerprint,
  isSlateSnapshotFresh,
  serializeBoardScan,
  SLATE_PRE_ANALYSIS_MAX_MS,
  type SlatePreAnalysisSnapshot,
} from "./coachSlateTypes.js";

let jobRunning = false;

export type CoachSlateJobSummary = {
  skipped: boolean;
  reason?: string;
  fingerprint?: string;
  boardScanPicks?: number;
  propSimCount?: number;
  oddsCount?: number;
  propPoolCount?: number;
  durationMs?: number;
  deepSimComplete?: boolean;
};

/** 24/7 AI Coach slate pre-analysis — warms caches, scans board, persists snapshot. */
export async function runCoachSlateJob(): Promise<{ ok: true; summary: CoachSlateJobSummary }> {
  if (jobRunning) {
    return { ok: true, summary: { skipped: true, reason: "already-running" } };
  }
  jobRunning = true;
  const started = Date.now();
  try {
    const existing = await getCoachPrecomputedSlate();

    await runPrebuildJobs().catch((err) => {
      logger.warn({ err }, "coach slate: prebuild warm failed (continuing)");
    });

    const built = await buildServerCompactParlayContext();
    const fingerprint = computeSlateFingerprint(built);

    if (
      existing.snapshot &&
      existing.snapshot.fingerprint === fingerprint &&
      isSlateSnapshotFresh(existing.snapshot) &&
      (existing.snapshot.boardScan?.picks?.length ?? 0) > 0 &&
      existing.deepSimComplete
    ) {
      return {
        ok: true,
        summary: {
          skipped: true,
          reason: "unchanged-fresh",
          fingerprint,
          boardScanPicks: existing.snapshot.boardScan?.picks?.length ?? 0,
          durationMs: Date.now() - started,
          deepSimComplete: existing.deepSimComplete,
        },
      };
    }

    const propSimulations = await enrichServerPropSims(built);
    const boardScan = await runServerBoardScan(built, { deepSim: true });

    const snapshot: SlatePreAnalysisSnapshot = {
      at: Date.now(),
      fingerprint: computeSlateFingerprint(built),
      built,
      propSimulations: [...propSimulations.entries()],
      boardScan: boardScan.picks.length ? serializeBoardScan(boardScan) : null,
      deepSimComplete: true,
    };

    await persistCoachPrecomputedSlate(snapshot);

    const summary: CoachSlateJobSummary = {
      skipped: false,
      fingerprint: snapshot.fingerprint,
      boardScanPicks: boardScan.picks.length,
      propSimCount: propSimulations.size,
      oddsCount: built.context.realOdds.length,
      propPoolCount: built.propPool.length,
      durationMs: Date.now() - started,
      deepSimComplete: true,
    };
    logger.info({ summary }, "coach slate cron run");
    return { ok: true, summary };
  } catch (err) {
    logger.error({ err }, "coach slate job failed");
    return {
      ok: true,
      summary: {
        skipped: true,
        reason: "error",
        durationMs: Date.now() - started,
      },
    };
  } finally {
    jobRunning = false;
  }
}

export { SLATE_PRE_ANALYSIS_MAX_MS };
