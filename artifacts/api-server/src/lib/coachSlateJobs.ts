import { logger } from "./logger.js";
import { runPrebuildJobs } from "./prebuildJobs.js";
import { buildServerCompactParlayContext } from "./coachSlateContext.js";
import { enrichServerPropSims, runServerBoardScan } from "./coachSlateBoardScan.js";
import { tryAcquireCoachSlateJobLock } from "./coachSlateJobLock.js";
import { logCoachSlatePhase, rssMb } from "./coachSlatePhaseMetrics.js";
import { getCoachPrecomputedSlate, persistCoachPrecomputedSlate } from "./coachSlateStore.js";
import {
  computeSlateFingerprint,
  isSlateSnapshotFresh,
  serializeBoardScan,
  SLATE_PRE_ANALYSIS_MAX_MS,
  SLATE_PRE_ANALYSIS_TARGET,
  type SlatePreAnalysisSnapshot,
  type SlateTicketsIndex,
} from "./coachSlateTypes.js";

let jobRunning = false;

export function isCoachSlateJobRunning(): boolean {
  return jobRunning;
}

/**
 * @deprecated Do not call from GET /coach/slate.
 * Starting a full slate job after the HTTP response caused Render edge 502s
 * (~20–25s later) via in-process cold-miss generation. Generation is cron-only.
 * This no-op remains so accidental callers cannot relaunch expensive work.
 */
export function scheduleCoachSlateRefresh(reason = "stale-serve"): void {
  logger.warn(
    { reason, jobRunning },
    "coach slate: scheduleCoachSlateRefresh is a no-op — use Render Cron Job worker",
  );
}

export type CoachSlateJobSummary = {
  skipped: boolean;
  reason?: string;
  fingerprint?: string;
  boardScanPicks?: number;
  ticketSizes?: number;
  sports?: number;
  propSimCount?: number;
  oddsCount?: number;
  propPoolCount?: number;
  durationMs?: number;
  deepSimComplete?: boolean;
  peakRssMb?: number;
};

function ticketsHaveMinCoverage(tickets: SlateTicketsIndex | null | undefined): boolean {
  if (!tickets?.global) return false;
  return (
    (tickets.global[15]?.picks.length ??
      tickets.global[10]?.picks.length ??
      tickets.global[3]?.picks.length ??
      0) > 0
  );
}

async function runCoachSlateJobBody(started: number): Promise<{
  ok: boolean;
  summary: CoachSlateJobSummary;
}> {
  let peakRss = rssMb();
  const noteRss = () => {
    peakRss = Math.max(peakRss, rssMb());
  };

  const existing = await getCoachPrecomputedSlate();

  let t = Date.now();
  await runPrebuildJobs().catch((err) => {
    logger.warn({ err }, "coach slate: prebuild warm failed (continuing)");
  });
  logCoachSlatePhase("prebuild", t);
  noteRss();

  t = Date.now();
  const built = await buildServerCompactParlayContext();
  const fingerprint = computeSlateFingerprint(built);
  const activeSports = built.context.selectedSports ?? [];
  logCoachSlatePhase("context_build", t, {
    sports: activeSports.length,
    oddsCount: built.context.realOdds.length,
    propPoolCount: built.propPool.length,
  });
  noteRss();

  const ageMs = existing.snapshot ? Date.now() - existing.snapshot.at : Infinity;
  const halfTtl = SLATE_PRE_ANALYSIS_MAX_MS / 2;

  if (
    existing.snapshot &&
    existing.snapshot.fingerprint === fingerprint &&
    isSlateSnapshotFresh(existing.snapshot) &&
    ageMs < halfTtl &&
    (existing.snapshot.boardScan?.picks?.length ?? 0) >= SLATE_PRE_ANALYSIS_TARGET &&
    ticketsHaveMinCoverage(existing.snapshot.tickets) &&
    existing.deepSimComplete
  ) {
    return {
      ok: true,
      summary: {
        skipped: true,
        reason: "unchanged-fresh",
        fingerprint,
        boardScanPicks: existing.snapshot.boardScan?.picks?.length ?? 0,
        ticketSizes: Object.keys(existing.snapshot.tickets?.global ?? {}).length,
        sports: activeSports.length,
        durationMs: Date.now() - started,
        deepSimComplete: existing.deepSimComplete,
        peakRssMb: peakRss,
      },
    };
  }

  t = Date.now();
  const propSimulations = await enrichServerPropSims(built);
  logCoachSlatePhase("prop_sims_enrich", t, { propSimCount: propSimulations.size });
  noteRss();

  t = Date.now();
  // Partials are intentionally not published — only the final deep-complete
  // snapshot may replace id=global (preserves last successful slate on failure).
  const { scan: boardScan, tickets } = await runServerBoardScan(built, {
    deepSim: true,
  });
  logCoachSlatePhase("board_scan", t, {
    boardScanPicks: boardScan.picks.length,
    ticketSizes: Object.keys(tickets.global).length,
  });
  noteRss();

  const snapshot: SlatePreAnalysisSnapshot = {
    at: Date.now(),
    fingerprint: computeSlateFingerprint(built),
    built,
    propSimulations: [...propSimulations.entries()],
    boardScan: boardScan.picks.length ? serializeBoardScan(boardScan) : null,
    tickets,
    activeSports,
    deepSimComplete: true,
  };

  t = Date.now();
  await persistCoachPrecomputedSlate(snapshot);
  logCoachSlatePhase("persist_final", t, {
    fingerprint: snapshot.fingerprint,
    deepSimComplete: true,
  });
  noteRss();

  const summary: CoachSlateJobSummary = {
    skipped: false,
    fingerprint: snapshot.fingerprint,
    boardScanPicks: boardScan.picks.length,
    ticketSizes: Object.keys(tickets.global).length,
    sports: activeSports.length,
    propSimCount: propSimulations.size,
    oddsCount: built.context.realOdds.length,
    propPoolCount: built.propPool.length,
    durationMs: Date.now() - started,
    deepSimComplete: true,
    peakRssMb: peakRss,
  };
  logger.info({ summary }, "coach slate cron run");
  return { ok: true, summary };
}

/**
 * Full slate pre-analysis under a Postgres advisory lock held for the entire job.
 * Call from the Render Cron Job worker CLI (preferred) or explicit web override.
 */
export async function runCoachSlateJob(): Promise<{
  ok: boolean;
  summary: CoachSlateJobSummary;
}> {
  if (jobRunning) {
    return { ok: true, summary: { skipped: true, reason: "already-running" } };
  }
  jobRunning = true;
  const started = Date.now();
  let lock: Awaited<ReturnType<typeof tryAcquireCoachSlateJobLock>> = null;
  try {
    const lockStarted = Date.now();
    lock = await tryAcquireCoachSlateJobLock();
    logCoachSlatePhase("lock", lockStarted, { acquired: !!lock });
    if (!lock) {
      return {
        ok: true,
        summary: {
          skipped: true,
          reason: "lock-held",
          durationMs: Date.now() - started,
          peakRssMb: rssMb(),
        },
      };
    }

    const result = await runCoachSlateJobBody(started);
    logCoachSlatePhase("total", started, {
      ok: result.ok,
      reason: result.summary.reason,
      peakRssMb: result.summary.peakRssMb,
    });
    return result;
  } catch (err) {
    logger.error({ err }, "coach slate job failed");
    logCoachSlatePhase("total", started, { ok: false, reason: "error", rssMb: rssMb() });
    return {
      ok: false,
      summary: {
        skipped: true,
        reason: "error",
        durationMs: Date.now() - started,
        peakRssMb: rssMb(),
      },
    };
  } finally {
    if (lock) {
      await lock.release();
    }
    jobRunning = false;
  }
}

export { SLATE_PRE_ANALYSIS_MAX_MS };
