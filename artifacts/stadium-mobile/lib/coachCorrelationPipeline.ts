/** Coach correlation stage — bounded batches, timeouts, fallback ranking. */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachBuildProgressCallback } from "./coachBuildProgress.ts";
import {
  buildIndependentCoachTicketAsync,
  type CoachTicketBuildOpts,
} from "./coachTicketCombinations.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import {
  coachScanPipelineIsStale,
  COACH_CORRELATION_TIMEOUT_MS,
  correlationDeadline,
  correlationTimedOut,
  logCoachScanCorrelationComplete,
  logCoachScanCorrelationStart,
  shouldSkipCorrelationScoring,
} from "./coachScanPipeline.ts";
import {
  boardLegPoolRole,
  buildBalancedStagedTicketFromScan,
  selectGreedyBoardLegs,
  tagTicketRoles,
  type BoardScoredLeg,
} from "./ticketStaging.ts";

export { COACH_CORRELATION_TIMEOUT_MS };

export const COACH_CORRELATION_BATCH_SIZE = 4;

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

export function logCoachScanCorrelationProgress(
  requestId: string,
  correlationsScored: number,
  candidateTicketCount: number,
  durationMs: number,
): void {
  if (coachScanPipelineIsStale(requestId)) return;
  logJson("[coach-scan] correlation-progress", {
    requestId,
    correlationsScored,
    candidateTicketCount,
    durationMs,
  });
}

export function logCoachScanCorrelationErrorRecord(
  requestId: string,
  message: string,
  durationMs: number,
  exceptions: string[],
  stack?: string,
): void {
  console.error(
    "[coach-scan] correlation-error",
    JSON.stringify({ requestId, message, durationMs, exceptions }),
  );
  if (stack) console.error(stack);
}

export function logCoachScanCorrelationTimeoutRecord(
  requestId: string,
  durationMs: number,
  correlationsScored: number,
  candidateTicketCount: number,
): void {
  console.error(
    "[coach-scan] correlation-timeout",
    JSON.stringify({
      requestId,
      durationMs,
      correlationsScored,
      candidateTicketCount,
    }),
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

function greedyFallbackTicket(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = filterQualifying(scored);
  const picks = tagTicketRoles(selectGreedyBoardLegs(qualifying, target, varietySeed));
  return { picks, breakdown: fallbackStagingBreakdown(picks, qualifying) };
}

/**
 * Run correlation scoring with bounded batches, per-ticket error tolerance,
 * timeout, and greedy fallback — never leaves the UI stuck at 89%.
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
    deadlineAt?: number;
    timeoutMs?: number;
  },
): Promise<CoachCorrelationStageResult> {
  const start = Date.now();
  const requestId = opts.requestId;
  const qualifying = filterQualifying(scored);
  const skipCorrelation = shouldSkipCorrelationScoring(qualifying.length, target);
  const deadlineAt =
    opts.deadlineAt ?? correlationDeadline(opts.timeoutMs ?? COACH_CORRELATION_TIMEOUT_MS);
  const exceptions: string[] = [];
  let usedFallback = false;
  let timedOut = false;
  let candidateTicketCount = 0;
  let correlationsScored = 0;

  logCoachScanCorrelationStart(
    requestId,
    qualifying.length,
    skipCorrelation ? undefined : opts.onBuildPhase,
    opts.onBuildProgress,
  );

  const finish = (
    result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown },
    meta: {
      candidateTicketCount: number;
      correlationsScored: number;
      usedFallback: boolean;
      timedOut: boolean;
    },
  ): CoachCorrelationStageResult => {
    const durationMs = Date.now() - start;
    logCoachScanCorrelationComplete(
      requestId,
      qualifying.length,
      result.picks.length,
      durationMs,
      opts.onBuildPhase,
      opts.onBuildProgress,
      {
        candidateTicketCount: meta.candidateTicketCount,
        correlationsScored: meta.correlationsScored,
        exceptions: exceptions.length ? exceptions : undefined,
        usedFallback: meta.usedFallback,
        timedOut: meta.timedOut,
      },
    );
    return {
      picks: result.picks,
      breakdown: result.breakdown,
      candidateTicketCount: meta.candidateTicketCount,
      correlationsScored: meta.correlationsScored,
      outputTicketCount: result.picks.length,
      durationMs,
      usedFallback: meta.usedFallback,
      timedOut: meta.timedOut,
      exceptions,
    };
  };

  try {
    if (correlationTimedOut(deadlineAt)) {
      timedOut = true;
      logCoachScanCorrelationTimeoutRecord(requestId, Date.now() - start, 0, 0);
      usedFallback = true;
      const fallback = greedyFallbackTicket(scored, target, opts.varietySeed);
      return finish(fallback, {
        candidateTicketCount: 0,
        correlationsScored: 0,
        usedFallback: true,
        timedOut: true,
      });
    }

    let result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown };

    if (target >= 3 && opts.varietySeed && !skipCorrelation) {
      const buildOpts: CoachTicketBuildOpts = {
        varietySeed: opts.varietySeed,
        ticketStyle: opts.ticketStyle,
        ...opts.varietyContext,
        correlationDeadlineAt: deadlineAt,
      };

      const batched = await buildIndependentCoachTicketAsync(scored, target, buildOpts, {
        batchSize: COACH_CORRELATION_BATCH_SIZE,
        deadlineAt,
        onProgress: (scoredCount, total) => {
          correlationsScored = scoredCount;
          candidateTicketCount = total;
          logCoachScanCorrelationProgress(
            requestId,
            scoredCount,
            total,
            Date.now() - start,
          );
        },
        onTicketError: (index, err) => {
          const message = err instanceof Error ? err.message : String(err);
          exceptions.push(`ticket-${index}: ${message}`);
        },
      });

      candidateTicketCount = batched.candidateTicketCount;
      correlationsScored = batched.correlationsScored;
      exceptions.push(...batched.exceptions);

      if (batched.timedOut) {
        timedOut = true;
        logCoachScanCorrelationTimeoutRecord(
          requestId,
          Date.now() - start,
          correlationsScored,
          candidateTicketCount,
        );
      }

      if (batched.picks.length > 0) {
        result = { picks: batched.picks, breakdown: batched.breakdown };
      } else {
        usedFallback = true;
        if (batched.exceptions.length) {
          logCoachScanCorrelationErrorRecord(
            requestId,
            "No correlation candidates survived — using greedy fallback",
            Date.now() - start,
            exceptions,
          );
        }
        result = greedyFallbackTicket(scored, target, opts.varietySeed);
      }
    } else if (target >= 3) {
      result = buildBalancedStagedTicketFromScan(
        scored,
        target,
        opts.varietySeed,
        opts.ticketStyle,
        skipCorrelation ? undefined : deadlineAt,
      );
      candidateTicketCount = 1;
      correlationsScored = 1;
    } else {
      result = buildBalancedStagedTicketFromScan(
        scored,
        target,
        opts.varietySeed,
        opts.ticketStyle,
        skipCorrelation ? undefined : deadlineAt,
      );
      candidateTicketCount = 1;
      correlationsScored = 1;
    }

    if (!usedFallback && timedOut && result.picks.length === 0) {
      usedFallback = true;
      result = greedyFallbackTicket(scored, target, opts.varietySeed);
    }

    return finish(result, {
      candidateTicketCount,
      correlationsScored,
      usedFallback,
      timedOut,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    exceptions.push(message);
    logCoachScanCorrelationErrorRecord(
      requestId,
      message,
      Date.now() - start,
      exceptions,
      stack,
    );
    usedFallback = true;
    const fallback = greedyFallbackTicket(scored, target, opts.varietySeed);
    return finish(fallback, {
      candidateTicketCount,
      correlationsScored,
      usedFallback: true,
      timedOut,
    });
  }
}
