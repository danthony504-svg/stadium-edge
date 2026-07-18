/** Coach correlation stage — hard deadline, bounded batches, fallback ranking. */

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

/** Score at most this many candidate tickets during correlation (20–40 band). */
export const COACH_CORRELATION_MAX_CANDIDATES = 32;
export const COACH_CORRELATION_BATCH_SIZE = 1;
/** Cap scored pool size for correlation assembly — avoids blocking the event loop. */
export const COACH_CORRELATION_MAX_POOL_LEGS = 64;

export function sliceScoredPoolForCorrelation(
  scored: BoardScoredLeg[],
  target: number,
): BoardScoredLeg[] {
  const cap = Math.max(COACH_CORRELATION_MAX_POOL_LEGS, target * 12);
  if (scored.length <= cap) return scored;
  const sorted = [...scored].sort((a, b) => b.rankScore - a.rankScore);
  return sorted.slice(0, cap);
}

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

/** Best pre-correlation greedy ranking — instant fallback when correlation times out. */
export function preCorrelationRanking(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = filterQualifying(scored);
  const picks = tagTicketRoles(selectGreedyBoardLegs(qualifying, target, varietySeed));
  return { picks, breakdown: fallbackStagingBreakdown(picks, qualifying) };
}

function correlationDeadlineAt(timeoutMs: number): number {
  return Date.now() + timeoutMs;
}

function correlationTimedOut(deadlineAt: number): boolean {
  return Date.now() >= deadlineAt;
}

async function runCorrelationWork(
  scored: BoardScoredLeg[],
  target: number,
  opts: {
    requestId: string;
    varietySeed?: string;
    ticketStyle?: CoachTicketBuildOpts["ticketStyle"];
    varietyContext?: Partial<CoachTicketBuildOpts>;
    deadlineAt: number;
    isAborted?: () => boolean;
    onProgress?: (correlationsScored: number, candidateTicketCount: number) => void;
    onTicketError?: (index: number, err: unknown) => void;
  },
): Promise<{
  picks: ParsedPick[];
  breakdown: TicketStagingBreakdown;
  candidateTicketCount: number;
  correlationsScored: number;
  timedOut: boolean;
  exceptions: string[];
}> {
  const buildOpts: CoachTicketBuildOpts = {
    varietySeed: opts.varietySeed!,
    ticketStyle: opts.ticketStyle,
    ...opts.varietyContext,
    correlationDeadlineAt: opts.deadlineAt,
    correlationFastMode: true,
  };

  const pool = sliceScoredPoolForCorrelation(scored, target);
  return buildIndependentCoachTicketAsync(pool, target, buildOpts, {
    batchSize: COACH_CORRELATION_BATCH_SIZE,
    deadlineAt: opts.deadlineAt,
    maxCandidates: COACH_CORRELATION_MAX_CANDIDATES,
    isAborted: opts.isAborted,
    onProgress: opts.onProgress,
    onTicketError: opts.onTicketError,
  });
}

/**
 * Run correlation with a hard 15s deadline. Never throws — always returns a ticket
 * (possibly via pre-correlation greedy fallback).
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
  const timeoutMs = opts.timeoutMs ?? COACH_CORRELATION_TIMEOUT_MS;
  const deadlineAt = correlationDeadlineAt(timeoutMs);
  const qualifying = filterQualifying(scored);
  const skipCorrelation = shouldSkipCorrelationScoring(qualifying.length, target);
  const preRanked = preCorrelationRanking(scored, target, opts.varietySeed);
  const exceptions: string[] = [];
  let usedFallback = false;
  let timedOut = false;
  let candidateTicketCount = 0;
  let correlationsScored = 0;

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
        ? buildBalancedStagedTicketFromScan(
            scored,
            target,
            opts.varietySeed,
            opts.ticketStyle,
            deadlineAt,
          )
        : preRanked;
    candidateTicketCount = 1;
    correlationsScored = 1;
    return finish(result, { usedFallback: skipCorrelation, timedOut: false });
  }

  logCoachCorrelationCandidateCount(requestId, COACH_CORRELATION_MAX_CANDIDATES);

  try {
    let correlationAborted = false;
    const isAborted = () =>
      correlationAborted || correlationTimedOut(deadlineAt) || coachScanPipelineIsStale(requestId);

    const work = runCorrelationWork(scored, target, {
      requestId,
      varietySeed: opts.varietySeed,
      ticketStyle: opts.ticketStyle,
      varietyContext: opts.varietyContext,
      deadlineAt,
      isAborted,
      onProgress: (scoredCount, total) => {
        correlationsScored = scoredCount;
        candidateTicketCount = total;
        logCoachCorrelationProgress(requestId, scoredCount, total, Date.now() - start);
      },
      onTicketError: (index, err) => {
        const message = err instanceof Error ? err.message : String(err);
        exceptions.push(`ticket-${index}: ${message}`);
      },
    });

    const timeout = new Promise<"timeout">((resolve) => {
      const wait = Math.max(0, deadlineAt - Date.now());
      setTimeout(() => {
        correlationAborted = true;
        resolve("timeout");
      }, wait);
    });

    const outcome = await Promise.race([work, timeout]);

    if (outcome === "timeout") {
      timedOut = true;
      usedFallback = true;
      logCoachCorrelationTimeoutFallback(
        requestId,
        Date.now() - start,
        correlationsScored,
        candidateTicketCount,
      );
      return finish(preRanked, { usedFallback: true, timedOut: true });
    }

    candidateTicketCount = outcome.candidateTicketCount;
    correlationsScored = outcome.correlationsScored;
    exceptions.push(...outcome.exceptions);
    timedOut = outcome.timedOut;

    if (timedOut) {
      usedFallback = true;
      logCoachCorrelationTimeoutFallback(
        requestId,
        Date.now() - start,
        correlationsScored,
        candidateTicketCount,
      );
      return finish(preRanked, { usedFallback: true, timedOut: true });
    }

    if (outcome.picks.length > 0) {
      return finish(
        { picks: outcome.picks, breakdown: outcome.breakdown },
        { usedFallback: false, timedOut: false },
      );
    }

    usedFallback = true;
    logCoachCorrelationErrorFallback(
      requestId,
      "No correlation ticket selected — using pre-correlation ranking",
      Date.now() - start,
      exceptions,
    );
    return finish(preRanked, { usedFallback: true, timedOut: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    exceptions.push(message);
    usedFallback = true;
    logCoachCorrelationErrorFallback(requestId, message, Date.now() - start, exceptions);
    return finish(preRanked, { usedFallback: true, timedOut });
  }
}
