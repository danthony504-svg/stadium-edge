/** Coach correlation stage — bounded fast search, hard timeout race, always resolves. */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachBuildProgressCallback } from "./coachBuildProgress.ts";
import type { CoachTicketBuildOpts } from "./coachTicketCombinations.ts";
import {
  FAST_CORRELATION_HARD_MS,
  FAST_CORRELATION_MAX_CANDIDATES,
  runFastCoachCorrelation,
} from "./coachFastCorrelation.ts";
import {
  logPipelineComplete,
  logPipelineCorrelationStart,
  logPipelineCorrelationTimeoutFired,
  logPipelineFallbackBuilderComplete,
  logPipelineFallbackBuilderStart,
  logPipelineFinalTicketBuildComplete,
  logPipelineFinalTicketBuildStart,
} from "./coachPipelineTrace.ts";
import {
  beginCoachPipelineCorrelation,
  coachPipelineCorrelationTimedOut,
  coachPipelineCurrentPhase,
  markCoachPipelineCorrelationTimedOut,
  settleCoachPipeline,
  transitionCoachPipeline,
} from "./coachPipelineStateMachine.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import {
  claimCoachCorrelationCompletion,
  coachCorrelationAlreadySettled,
  coachScanPipelineIsStale,
  COACH_CORRELATION_TIMEOUT_MS,
  shouldSkipCorrelationScoring,
} from "./coachScanPipeline.ts";
import {
  boardLegPoolRole,
  buildBalancedStagedTicketFromScan,
  selectGreedyBoardLegs,
  tagTicketRoles,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

export {
  FAST_CORRELATION_HARD_MS,
  FAST_CORRELATION_MAX_CANDIDATES as COACH_CORRELATION_MAX_CANDIDATES,
} from "./coachFastCorrelation.ts";

export { COACH_CORRELATION_TIMEOUT_MS };
export { logCoachTicketRenderComplete } from "./coachPipelineTrace.ts";

export type CoachCorrelationFallbackReason =
  | "correlation-timeout"
  | "no-candidates"
  | "error";

export type CoachCorrelationStageResult = {
  picks: ParsedPick[];
  selectedLegs: ParsedPick[];
  requestedLegCount: number;
  breakdown: TicketStagingBreakdown;
  candidateTicketCount: number;
  candidateCount: number;
  correlationsScored: number;
  ticketsScored: number;
  outputTicketCount: number;
  durationMs: number;
  correlationDurationMs: number;
  usedFallback: boolean;
  fallbackUsed: boolean;
  fallbackReason?: CoachCorrelationFallbackReason;
  timedOut: boolean;
  exceptions: string[];
};

function logJson(tag: string, payload: Record<string, unknown>): void {
  console.log(tag, JSON.stringify(payload));
}

export function logCoachCorrelationStart(requestId: string, candidateLegCount: number): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-correlation] start", { requestId, candidateLegCount });
}

export function logCoachCorrelationCandidateCount(
  requestId: string,
  candidateTicketCount: number,
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-correlation] candidateCount", { requestId, candidateTicketCount });
}

export function logCoachCorrelationProgress(
  requestId: string,
  correlationsScored: number,
  candidateTicketCount: number,
  durationMs: number,
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-correlation] progress", {
    requestId,
    correlationsScored,
    candidateTicketCount,
    durationMs,
  });
}

export function logCoachCorrelationComplete(
  requestId: string,
  payload: {
    candidateTicketCount: number;
    correlationsScored: number;
    outputTicketCount: number;
    durationMs: number;
    usedFallback: boolean;
    timedOut: boolean;
    fallbackReason?: CoachCorrelationFallbackReason;
    exceptions?: string[];
  },
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-correlation] complete", { requestId, ...payload });
}

export function logCoachTicketBuildStart(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
): void {
  logJson("[coach-ticket] build-start", { requestId, pickCount, requestedLegCount });
}

function filterQualifying(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  return scored.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null);
}

function fallbackStagingBreakdown(
  picks: ParsedPick[],
  qualifying: BoardScoredLeg[],
): TicketStagingBreakdown {
  const mains = qualifying.filter(
    (leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "main",
  );
  const alts = qualifying.filter(
    (leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "alt",
  );
  return {
    mainQualified: mains.length,
    altQualified: alts.length,
    mainOnTicket: picks.filter((p) => p.ticketRole === "main").length,
    altOnTicket: picks.filter((p) => p.ticketRole === "alt").length,
  };
}

/** Best pre-correlation greedy ranking — used when correlation times out. */
const FALLBACK_RANKING_POOL_CAP = 80;

export function preCorrelationRanking(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  let qualifying = filterQualifying(scored);
  if (qualifying.length > FALLBACK_RANKING_POOL_CAP) {
    qualifying = [...qualifying]
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, FALLBACK_RANKING_POOL_CAP);
  }
  const picks = tagTicketRoles(selectGreedyBoardLegs(qualifying, target, varietySeed));
  return { picks, breakdown: fallbackStagingBreakdown(picks, qualifying) };
}

function buildStageResult(
  result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown },
  meta: {
    requestId: string;
    target: number;
    candidateTicketCount: number;
    correlationsScored: number;
    durationMs: number;
    usedFallback: boolean;
    fallbackUsed: boolean;
    fallbackReason?: CoachCorrelationFallbackReason;
    timedOut: boolean;
    exceptions: string[];
  },
): CoachCorrelationStageResult {
  return {
    picks: result.picks,
    selectedLegs: result.picks,
    requestedLegCount: meta.target,
    breakdown: result.breakdown,
    candidateTicketCount: meta.candidateTicketCount,
    candidateCount: meta.candidateTicketCount,
    correlationsScored: meta.correlationsScored,
    ticketsScored: meta.correlationsScored,
    outputTicketCount: result.picks.length,
    durationMs: meta.durationMs,
    correlationDurationMs: meta.durationMs,
    usedFallback: meta.usedFallback,
    fallbackUsed: meta.fallbackUsed,
    fallbackReason: meta.fallbackReason,
    timedOut: meta.timedOut,
    exceptions: meta.exceptions,
  };
}

function emitProgress(
  opts: {
    onBuildProgress?: CoachBuildProgressCallback;
    onBuildPhase?: import("./coachScanPipeline.ts").CoachScanPhaseCallback;
  },
  stageId: Parameters<CoachBuildProgressCallback>[0],
  requestId: string,
): void {
  opts.onBuildProgress?.(stageId, requestId);
}

/**
 * Run bounded fast correlation. Always resolves within hardMs — never hangs.
 * Timeout uses pre-correlation ranking and advances through fallback → build.
 */
export function runCoachCorrelationStage(
  scored: BoardScoredLeg[],
  target: number,
  opts: {
    requestId: string;
    varietySeed?: string;
    ticketStyle?: CoachTicketBuildOpts["ticketStyle"];
    varietyContext?: Partial<CoachTicketBuildOpts>;
    onBuildProgress?: CoachBuildProgressCallback;
    onBuildPhase?: import("./coachScanPipeline.ts").CoachScanPhaseCallback;
    timeoutMs?: number;
  },
): Promise<CoachCorrelationStageResult> {
  const start = Date.now();
  const requestId = opts.requestId;
  const hardMs = Math.min(opts.timeoutMs ?? COACH_CORRELATION_TIMEOUT_MS, FAST_CORRELATION_HARD_MS);
  const qualifying = filterQualifying(scored);
  const skipCorrelation = shouldSkipCorrelationScoring(qualifying.length, target);
  const exceptions: string[] = [];
  let candidateTicketCount = FAST_CORRELATION_MAX_CANDIDATES;
  let correlationsScored = 0;
  let settled = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let outerResolve: ((value: CoachCorrelationStageResult) => void) | null = null;

  const buildPreRanked = (): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } => {
    logPipelineFallbackBuilderStart(requestId, { target, poolSize: scored.length });
    const ranked = preCorrelationRanking(scored, target, opts.varietySeed);
    logPipelineFallbackBuilderComplete(requestId, ranked.picks.length, target);
    return ranked;
  };

  const finish = (
    result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown },
    meta: {
      usedFallback: boolean;
      fallbackUsed: boolean;
      fallbackReason?: CoachCorrelationFallbackReason;
      timedOut: boolean;
      advanceFallbackStage?: boolean;
    },
  ): CoachCorrelationStageResult => {
    const durationMs = Date.now() - start;

    if (meta.advanceFallbackStage) {
      transitionCoachPipeline(
        requestId,
        "CORRELATION_TIMEOUT_FALLBACK",
        meta.fallbackReason ?? "correlation-timeout",
      );
    }

    const claimed = claimCoachCorrelationCompletion(requestId);
    if (!claimed) {
      return buildStageResult(result, {
        requestId,
        target,
        candidateTicketCount,
        correlationsScored,
        durationMs,
        usedFallback: meta.usedFallback,
        fallbackUsed: meta.fallbackUsed,
        fallbackReason: meta.fallbackReason,
        timedOut: meta.timedOut,
        exceptions,
      });
    }

    logCoachCorrelationComplete(requestId, {
      candidateTicketCount,
      correlationsScored,
      outputTicketCount: result.picks.length,
      durationMs,
      usedFallback: meta.usedFallback,
      timedOut: meta.timedOut,
      fallbackReason: meta.fallbackReason,
      exceptions: exceptions.length ? exceptions : undefined,
    });

    if (meta.advanceFallbackStage) {
      emitProgress(opts, "correlation-fallback", requestId);
    }

    transitionCoachPipeline(requestId, "BUILDING_FINAL_TICKET", "final-ticket-build");
    logPipelineFinalTicketBuildStart(requestId, result.picks.length, target);
    logCoachTicketBuildStart(requestId, result.picks.length, target);
    emitProgress(opts, "building-ticket", requestId);
    opts.onBuildPhase?.("score", requestId);
    logPipelineFinalTicketBuildComplete(requestId, result.picks.length, target);
    transitionCoachPipeline(requestId, "FINAL_TICKET_READY", "ticket-built");

    return buildStageResult(result, {
      requestId,
      target,
      candidateTicketCount,
      correlationsScored,
      durationMs,
      usedFallback: meta.usedFallback,
      fallbackUsed: meta.fallbackUsed,
      fallbackReason: meta.fallbackReason,
      timedOut: meta.timedOut,
      exceptions,
    });
  };

  const resolveOnce = (
    result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown },
    meta: {
      usedFallback: boolean;
      fallbackUsed: boolean;
      fallbackReason?: CoachCorrelationFallbackReason;
      timedOut: boolean;
      advanceFallbackStage?: boolean;
    },
  ): CoachCorrelationStageResult => {
    if (settled) {
      return buildStageResult(result, {
        requestId,
        target,
        candidateTicketCount,
        correlationsScored,
        durationMs: Date.now() - start,
        usedFallback: meta.usedFallback,
        fallbackUsed: meta.fallbackUsed,
        fallbackReason: meta.fallbackReason,
        timedOut: meta.timedOut,
        exceptions,
      });
    }
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);

    let stageResult: CoachCorrelationStageResult;
    try {
      stageResult = finish(result, meta);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exceptions.push(message);
      stageResult = buildStageResult(result, {
        requestId,
        target,
        candidateTicketCount,
        correlationsScored,
        durationMs: Date.now() - start,
        usedFallback: true,
        fallbackUsed: true,
        fallbackReason: "error",
        timedOut: meta.timedOut,
        exceptions,
      });
    }

    settleCoachPipeline(requestId, meta.timedOut ? "correlation-timeout" : "correlation-complete");
    logPipelineComplete(requestId, {
      pickCount: stageResult.outputTicketCount,
      fallbackUsed: stageResult.fallbackUsed,
      fallbackReason: stageResult.fallbackReason,
      timedOut: stageResult.timedOut,
      durationMs: stageResult.durationMs,
    });
    outerResolve?.(stageResult);
    return stageResult;
  };

  const runTimeoutFallback = (reason: CoachCorrelationFallbackReason): void => {
    if (settled) return;
    markCoachPipelineCorrelationTimedOut(requestId);
    logPipelineCorrelationTimeoutFired(requestId, Date.now() - start, { reason });
    try {
      const ranked = buildPreRanked();
      resolveOnce(ranked, {
        usedFallback: true,
        fallbackUsed: true,
        fallbackReason: reason,
        timedOut: true,
        advanceFallbackStage: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      exceptions.push(message);
      resolveOnce(
        { picks: [], breakdown: fallbackStagingBreakdown([], filterQualifying(scored)) },
        {
          usedFallback: true,
          fallbackUsed: true,
          fallbackReason: "error",
          timedOut: true,
          advanceFallbackStage: true,
        },
      );
    }
  };

  if (coachPipelineCurrentPhase(requestId) !== "SCORING_CORRELATION") {
    beginCoachPipelineCorrelation(requestId, "runCoachCorrelationStage");
  }
  logPipelineCorrelationStart(requestId, { target, poolSize: scored.length });
  logCoachCorrelationStart(requestId, qualifying.length);
  emitProgress(opts, "correlation", requestId);
  opts.onBuildPhase?.("stream", requestId);

  if (skipCorrelation || target < 3 || !opts.varietySeed) {
    const result =
      target >= 3
        ? buildBalancedStagedTicketFromScan(scored, target, opts.varietySeed, opts.ticketStyle)
        : buildPreRanked();
    candidateTicketCount = 1;
    correlationsScored = 1;
    return Promise.resolve(
      resolveOnce(result, {
        usedFallback: skipCorrelation,
        fallbackUsed: skipCorrelation,
        timedOut: false,
      }),
    );
  }

  logCoachCorrelationCandidateCount(requestId, FAST_CORRELATION_MAX_CANDIDATES);

  return new Promise<CoachCorrelationStageResult>((resolve) => {
    outerResolve = resolve;

    timeoutTimer = setTimeout(() => {
      runTimeoutFallback("correlation-timeout");
    }, hardMs);

    void (async () => {
      try {
        const hardDeadline = start + hardMs;
        const outcome = await runFastCoachCorrelation(scored, target, {
          varietySeed: opts.varietySeed,
          hardMs,
          isAborted: () =>
            settled ||
            coachPipelineCorrelationTimedOut(requestId) ||
            coachCorrelationAlreadySettled(requestId) ||
            coachScanPipelineIsStale(requestId) ||
            Date.now() >= hardDeadline,
          onProgress: (scoredCount, cap) => {
            if (settled || coachPipelineCorrelationTimedOut(requestId)) return;
            correlationsScored = scoredCount;
            candidateTicketCount = cap;
            logCoachCorrelationProgress(requestId, scoredCount, cap, Date.now() - start);
          },
        });

        if (settled || coachPipelineCorrelationTimedOut(requestId)) return;

        correlationsScored = outcome.ticketsScored;
        candidateTicketCount = outcome.candidateCount;

        if (outcome.timedOut || outcome.picks.length === 0) {
          runTimeoutFallback(outcome.timedOut ? "correlation-timeout" : "no-candidates");
          return;
        }

        const qualifyingPool = filterQualifying(scored);
        resolveOnce(
          {
            picks: outcome.picks,
            breakdown: fallbackStagingBreakdown(outcome.picks, qualifyingPool),
          },
          { usedFallback: false, fallbackUsed: false, timedOut: false },
        );
      } catch (err) {
        if (settled || coachPipelineCorrelationTimedOut(requestId)) return;
        const message = err instanceof Error ? err.message : String(err);
        exceptions.push(message);
        console.error(
          "[coach-correlation] error-fallback",
          JSON.stringify({ requestId, message, exceptions }),
        );
        runTimeoutFallback("error");
      }
    })();
  });
}
