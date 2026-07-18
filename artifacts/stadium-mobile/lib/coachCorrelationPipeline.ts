/** Coach correlation stage — bounded fast search, hard 3s cap, always returns a ticket. */

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

export type CoachCorrelationStageResult = {
  picks: ParsedPick[];
  breakdown: TicketStagingBreakdown;
  candidateTicketCount: number;
  correlationsScored: number;
  outputTicketCount: number;
  durationMs: number;
  usedFallback: boolean;
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
    exceptions?: string[];
  },
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-correlation] complete", { requestId, ...payload });
}

export function logCoachCorrelationTimeoutFallback(
  requestId: string,
  durationMs: number,
  correlationsScored: number,
  candidateTicketCount: number,
): void {
  console.error(
    "[coach-correlation] timeout-fallback",
    JSON.stringify({ requestId, durationMs, correlationsScored, candidateTicketCount }),
  );
}

export function logCoachCorrelationErrorFallback(
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

/** Best pre-correlation greedy ranking — instant fallback when search finds nothing. */
export function preCorrelationRanking(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = filterQualifying(scored);
  const picks = tagTicketRoles(selectGreedyBoardLegs(qualifying, target, varietySeed));
  return { picks, breakdown: fallbackStagingBreakdown(picks, qualifying) };
}

/**
 * Run bounded fast correlation. Never throws — always returns a ticket when picks exist.
 * Hard cap 3s; search stops at 2s or 10 high-quality tickets (whichever first).
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
  let usedFallback = false;
  let timedOut = false;

  logCoachCorrelationStart(requestId, qualifying.length);
  opts.onBuildProgress?.("correlation", requestId);
  opts.onBuildPhase?.("stream", requestId);

  const finish = (
    result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown },
    meta: { usedFallback: boolean; timedOut: boolean },
  ): CoachCorrelationStageResult => {
    const durationMs = Date.now() - start;
    logCoachCorrelationComplete(requestId, {
      candidateTicketCount,
      correlationsScored,
      outputTicketCount: result.picks.length,
      durationMs,
      usedFallback: meta.usedFallback,
      timedOut: meta.timedOut,
      exceptions: exceptions.length ? exceptions : undefined,
    });
    opts.onBuildProgress?.("building-ticket", requestId);
    opts.onBuildPhase?.("score", requestId);
    return {
      picks: result.picks,
      breakdown: result.breakdown,
      candidateTicketCount,
      correlationsScored,
      outputTicketCount: result.picks.length,
      durationMs,
      usedFallback: meta.usedFallback,
      timedOut: meta.timedOut,
      exceptions,
    };
  };

  if (skipCorrelation || target < 3 || !opts.varietySeed) {
    const result =
      target >= 3
        ? buildBalancedStagedTicketFromScan(scored, target, opts.varietySeed, opts.ticketStyle)
        : preRanked;
    candidateTicketCount = 1;
    correlationsScored = 1;
    return finish(result, { usedFallback: skipCorrelation, timedOut: false });
  }

  logCoachCorrelationCandidateCount(requestId, FAST_CORRELATION_MAX_CANDIDATES);

  try {
    const hardDeadline = start + hardMs;
    const outcome = await runFastCoachCorrelation(scored, target, {
      varietySeed: opts.varietySeed,
      hardMs,
      isAborted: () =>
        Date.now() >= hardDeadline || coachScanPipelineIsStale(requestId),
      onProgress: (scoredCount, cap) => {
        correlationsScored = scoredCount;
        candidateTicketCount = cap;
        logCoachCorrelationProgress(requestId, scoredCount, cap, Date.now() - start);
      },
    });

    correlationsScored = outcome.ticketsScored;
    candidateTicketCount = outcome.candidateCount;
    timedOut = outcome.timedOut;

    if (outcome.picks.length > 0) {
      const qualifyingPool = filterQualifying(scored);
      return finish(
        {
          picks: outcome.picks,
          breakdown: fallbackStagingBreakdown(outcome.picks, qualifyingPool),
        },
        { usedFallback: outcome.usedFallback, timedOut },
      );
    }

    usedFallback = true;
    if (timedOut) {
      logCoachCorrelationTimeoutFallback(
        requestId,
        Date.now() - start,
        correlationsScored,
        candidateTicketCount,
      );
    } else {
      logCoachCorrelationErrorFallback(
        requestId,
        "No scored tickets — using pre-correlation ranking",
        Date.now() - start,
        exceptions,
      );
    }
    return finish(preRanked, { usedFallback: true, timedOut });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    exceptions.push(message);
    usedFallback = true;
    logCoachCorrelationErrorFallback(requestId, message, Date.now() - start, exceptions);
    return finish(preRanked, { usedFallback: true, timedOut });
  }
}
