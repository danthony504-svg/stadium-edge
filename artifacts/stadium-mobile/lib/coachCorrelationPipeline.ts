/** Coach correlation stage — bounded fast search, timeout fallback, always completes. */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachBuildProgressCallback } from "./coachBuildProgress.ts";
import type { CoachTicketBuildOpts } from "./coachTicketCombinations.ts";
import {
  FAST_CORRELATION_HARD_MS,
  FAST_CORRELATION_MAX_CANDIDATES,
  runFastCoachCorrelation,
} from "./coachFastCorrelation.ts";
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

export function logCoachCorrelationTimeoutFallbackStart(
  requestId: string,
  durationMs: number,
  candidateTicketCount: number,
): void {
  console.log(
    "[coach-correlation] timeout-fallback-start",
    JSON.stringify({ requestId, durationMs, candidateTicketCount }),
  );
}

export function logCoachCorrelationTimeoutFallbackSelected(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
  durationMs: number,
): void {
  console.log(
    "[coach-correlation] timeout-fallback-selected",
    JSON.stringify({ requestId, pickCount, requestedLegCount, durationMs }),
  );
}

export function logCoachTicketBuildStart(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
): void {
  logJson("[coach-ticket] build-start", { requestId, pickCount, requestedLegCount });
}

export function logCoachTicketRenderComplete(
  requestId: string,
  pickCount: number,
  requestedLegCount: number,
): void {
  logJson("[coach-ticket] render-complete", { requestId, pickCount, requestedLegCount });
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
export function preCorrelationRanking(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = filterQualifying(scored);
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

/**
 * Run bounded fast correlation. Never throws — always returns a usable ticket when
 * valid legs exist. Timeout uses pre-correlation ranking and advances to build.
 */
export async function runCoachCorrelationStage(
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
  const preRanked = preCorrelationRanking(scored, target, opts.varietySeed);
  const exceptions: string[] = [];
  let candidateTicketCount = FAST_CORRELATION_MAX_CANDIDATES;
  let correlationsScored = 0;
  let correlationSettled = false;

  const isAborted = () =>
    correlationSettled ||
    coachCorrelationAlreadySettled(requestId) ||
    coachScanPipelineIsStale(requestId);

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
    if (!claimCoachCorrelationCompletion(requestId)) {
      return buildStageResult(preRanked, {
        requestId,
        target,
        candidateTicketCount,
        correlationsScored,
        durationMs: Date.now() - start,
        usedFallback: true,
        fallbackUsed: true,
        fallbackReason: "correlation-timeout",
        timedOut: true,
        exceptions,
      });
    }
    correlationSettled = true;

    const durationMs = Date.now() - start;
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
      opts.onBuildProgress?.("correlation-fallback", requestId);
    }
    logCoachTicketBuildStart(requestId, result.picks.length, target);
    opts.onBuildProgress?.("building-ticket", requestId);
    opts.onBuildPhase?.("score", requestId);

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

  logCoachCorrelationStart(requestId, qualifying.length);
  opts.onBuildProgress?.("correlation", requestId);
  opts.onBuildPhase?.("stream", requestId);

  if (skipCorrelation || target < 3 || !opts.varietySeed) {
    const result =
      target >= 3
        ? buildBalancedStagedTicketFromScan(scored, target, opts.varietySeed, opts.ticketStyle)
        : preRanked;
    candidateTicketCount = 1;
    correlationsScored = 1;
    return finish(result, {
      usedFallback: skipCorrelation,
      fallbackUsed: skipCorrelation,
      timedOut: false,
    });
  }

  logCoachCorrelationCandidateCount(requestId, FAST_CORRELATION_MAX_CANDIDATES);

  try {
    const hardDeadline = start + hardMs;
    const outcome = await runFastCoachCorrelation(scored, target, {
      varietySeed: opts.varietySeed,
      hardMs,
      isAborted: () => isAborted() || Date.now() >= hardDeadline,
      onProgress: (scoredCount, cap) => {
        if (isAborted()) return;
        correlationsScored = scoredCount;
        candidateTicketCount = cap;
        logCoachCorrelationProgress(requestId, scoredCount, cap, Date.now() - start);
      },
    });

    if (isAborted()) {
      return finish(preRanked, {
        usedFallback: true,
        fallbackUsed: true,
        fallbackReason: "correlation-timeout",
        timedOut: true,
        advanceFallbackStage: true,
      });
    }

    correlationsScored = outcome.ticketsScored;
    candidateTicketCount = outcome.candidateCount;

    if (outcome.timedOut) {
      logCoachCorrelationTimeoutFallbackStart(
        requestId,
        Date.now() - start,
        candidateTicketCount,
      );
      logCoachCorrelationTimeoutFallbackSelected(
        requestId,
        preRanked.picks.length,
        target,
        Date.now() - start,
      );
      return finish(preRanked, {
        usedFallback: true,
        fallbackUsed: true,
        fallbackReason: "correlation-timeout",
        timedOut: true,
        advanceFallbackStage: true,
      });
    }

    if (outcome.picks.length > 0) {
      const qualifyingPool = filterQualifying(scored);
      return finish(
        {
          picks: outcome.picks,
          breakdown: fallbackStagingBreakdown(outcome.picks, qualifyingPool),
        },
        { usedFallback: false, fallbackUsed: false, timedOut: false },
      );
    }

    logCoachCorrelationErrorFallback(
      requestId,
      "No scored tickets — using pre-correlation ranking",
      Date.now() - start,
      exceptions,
    );
    return finish(preRanked, {
      usedFallback: true,
      fallbackUsed: true,
      fallbackReason: "no-candidates",
      timedOut: false,
      advanceFallbackStage: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    exceptions.push(message);
    logCoachCorrelationErrorFallback(requestId, message, Date.now() - start, exceptions);
    return finish(preRanked, {
      usedFallback: true,
      fallbackUsed: true,
      fallbackReason: "error",
      timedOut: false,
      advanceFallbackStage: true,
    });
  }
}

function logCoachCorrelationErrorFallback(
  requestId: string,
  message: string,
  durationMs: number,
  exceptions: string[],
): void {
  console.error(
    "[coach-correlation] error-fallback",
    JSON.stringify({ requestId, message, durationMs, exceptions }),
  );
}
