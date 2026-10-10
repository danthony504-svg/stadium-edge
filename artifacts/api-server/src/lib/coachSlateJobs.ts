import { logger } from "./logger.js";
import { runPrebuildJobs } from "./prebuildJobs.js";
import { buildServerCompactParlayContext } from "./coachSlateContext.js";
import { enrichServerPropSims, runServerBoardScan } from "./coachSlateBoardScan.js";
import { getCoachPrecomputedSlate, persistCoachPrecomputedSlate } from "./coachSlateStore.js";
import {
  computeSlateFingerprint,
  isSlateSnapshotFresh,
  serializeBoardScan,
  SLATE_PARLAY_SIZES,
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
    "coach slate: scheduleCoachSlateRefresh is a no-op — use POST /api/coach/slate/cron",
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

/**
 * Full slate pre-analysis (odds fan-out, board scan, deep sim, DB persist).
 * Call only from authenticated POST /api/coach/slate/cron (or an equivalent worker).
 * Concurrent callers get `{ skipped: true, reason: "already-running" }` — single-flight.
 * On failure returns ok:false so cron HTTP / GH Actions fail closed.
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
  try {
    const existing = await getCoachPrecomputedSlate();

    await runPrebuildJobs().catch((err) => {
      logger.warn({ err }, "coach slate: prebuild warm failed (continuing)");
    });

    const built = await buildServerCompactParlayContext();
    const fingerprint = computeSlateFingerprint(built);
    const activeSports = built.context.selectedSports ?? [];

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
        },
      };
    }

    const propSimulations = await enrichServerPropSims(built);

    let lastPartialAt = 0;
    const { scan: boardScan, tickets } = await runServerBoardScan(built, {
      deepSim: true,
      onPartial: async (partial, partialTickets) => {
        if (!partial.picks.length) return;
        const now = Date.now();
        if (now - lastPartialAt < 4000) return;
        lastPartialAt = now;
        const partialSnapshot: SlatePreAnalysisSnapshot = {
          at: now,
          fingerprint,
          built,
          propSimulations: [...propSimulations.entries()],
          boardScan: serializeBoardScan(partial),
          tickets: partialTickets,
          activeSports,
          deepSimComplete: false,
        };
        await persistCoachPrecomputedSlate(partialSnapshot).catch((err) => {
          logger.warn({ err }, "coach slate partial persist failed");
        });
      },
    });

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

    await persistCoachPrecomputedSlate(snapshot);

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
    };
    logger.info({ summary }, "coach slate cron run");
    return { ok: true, summary };
  } catch (err) {
    logger.error({ err }, "coach slate job failed");
    // ok:false so cron HTTP handlers / GH Actions cannot report success on failure.
    return {
      ok: false,
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
