// Final ticket assembly — single-shot handoff after correlation with 5s deadline.

import type { ParsedPick } from "../components/PickCard.ts";
import {
  finalizeCoachPipelineTickets,
  type CoachPipelineFinalizeInput,
} from "./coachPipelineFinalize.ts";
import { activeCoachRequestId, isActiveCoachRun } from "./coachRunTrace.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { coerceCoachDisplayPicks } from "./coachTicketKernel.ts";

export const FINAL_TICKET_ASSEMBLY_DEADLINE_MS = 5000;

export type FinalTicketAssemblyResult = {
  picks: ParsedPick[];
  failureReason: string | null;
  timedOut: boolean;
  skipped?: boolean;
  stale?: boolean;
  candidateCount: number;
  selectedCount: number;
};

const completedHandoffs = new Set<string>();
const handoffPickCache = new Map<string, ParsedPick[]>();

export function resetCoachFinalHandoffForTests(): void {
  completedHandoffs.clear();
  handoffPickCache.clear();
}

export function wasFinalTicketHandoffCompleted(requestId: string | null | undefined): boolean {
  return !!requestId && completedHandoffs.has(requestId);
}

export function logCoachFinal(step: string, payload: Record<string, unknown>): void {
  console.log(`[coach-final] ${step}`, JSON.stringify(payload));
}

export function logCorrelationDone(opts: {
  requestId: string;
  candidateCount: number;
  selectedCount: number;
  requestedLegs: number;
}): void {
  logCoachFinal("correlation-done", opts);
}

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

export function salvageHighestRanked(
  candidates: readonly ParsedPick[],
  enrich: CoachPipelineFinalizeInput["enrich"],
  legTarget: number,
): ParsedPick[] {
  const ranked = [...candidates].sort((a, b) => pickRank(b) - pickRank(a));
  const coerced = coerceCoachDisplayPicks(ranked, enrich);
  const pool = coerced.length ? coerced : ranked;
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  for (const p of pool) {
    const fp = pickLegFingerprint(p);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(p);
    if (legTarget > 0 && out.length >= legTarget) break;
  }
  return legTarget > 0 ? out.slice(0, legTarget) : out;
}

function runPipelineWithDeadline(
  input: CoachPipelineFinalizeInput,
  deadlineMs: number,
): { pipeline: ReturnType<typeof finalizeCoachPipelineTickets>; timedOut: boolean; elapsedMs: number } {
  const start = Date.now();
  const deadline = start + deadlineMs;
  const pipeline = finalizeCoachPipelineTickets({
    ...input,
    relaxCorrelation: input.relaxCorrelation ?? true,
  });
  const elapsedMs = Date.now() - start;
  return { pipeline, timedOut: elapsedMs > deadlineMs, elapsedMs };
}

/**
 * Run final ticket assembly exactly once per requestId after correlation completes.
 * Never returns empty when candidates exist for the active request.
 */
export function executeFinalTicketHandoff(
  input: CoachPipelineFinalizeInput,
): FinalTicketAssemblyResult {
  const { requestId, candidates, requestedLegs, enrich } = input;
  const candidateCount = candidates.length;
  const active = activeCoachRequestId();

  if (requestId && completedHandoffs.has(requestId)) {
    const cached = handoffPickCache.get(requestId) ?? [];
    logCoachFinal("assembly-start", {
      requestId,
      skipped: true,
      reason: "already-finalized",
      cachedPickCount: cached.length,
    });
    return {
      picks: cached,
      failureReason: cached.length ? null : "already-finalized",
      timedOut: false,
      skipped: true,
      candidateCount,
      selectedCount: cached.length,
    };
  }

  if (requestId && active && requestId !== active) {
    logCoachFinal("assembly-start", { requestId, stale: true, activeRequestId: active });
    return {
      picks: [],
      failureReason: "stale-request",
      timedOut: false,
      stale: true,
      candidateCount,
      selectedCount: 0,
    };
  }

  if (requestId && !isActiveCoachRun(requestId) && active) {
    logCoachFinal("assembly-start", { requestId, stale: true, activeRequestId: active });
    return {
      picks: [],
      failureReason: "stale-request",
      timedOut: false,
      stale: true,
      candidateCount,
      selectedCount: 0,
    };
  }

  logCoachFinal("assembly-start", {
    requestId,
    candidateCount,
    requestedLegs,
    deadlineMs: FINAL_TICKET_ASSEMBLY_DEADLINE_MS,
  });

  let failureReason: string | null = null;
  let timedOut = false;
  let picks: ParsedPick[] = [];

  try {
    const { pipeline, timedOut: pipelineTimedOut, elapsedMs } = runPipelineWithDeadline(
      input,
      FINAL_TICKET_ASSEMBLY_DEADLINE_MS,
    );
    timedOut = pipelineTimedOut;
    logCoachFinal("dedupe-complete", {
      requestId,
      candidateCount,
      selectedCount: pipeline.selectedCount,
      elapsedMs,
    });
    logCoachFinal("alternates-complete", {
      requestId,
      selectedCount: pipeline.selectedCount,
      salvageUsed: pipeline.salvageUsed,
      elapsedMs,
    });
    picks = pipeline.picks;

    if (!picks.length && candidateCount) {
      failureReason = "strict-gates-zeroed-candidates";
      picks = salvageHighestRanked(candidates, enrich, requestedLegs);
    }
    if (timedOut) {
      failureReason = failureReason ?? "final-assembly-timeout";
      if (!picks.length && candidateCount) {
        picks = salvageHighestRanked(candidates, enrich, requestedLegs);
      }
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn(
          `[coach-final] assembly exceeded ${FINAL_TICKET_ASSEMBLY_DEADLINE_MS}ms — salvage picks used`,
          { requestId, elapsedMs, pickCount: picks.length },
        );
      }
    }
  } catch (err) {
    failureReason = err instanceof Error ? err.message : "final-assembly-error";
    picks = candidateCount ? salvageHighestRanked(candidates, enrich, requestedLegs) : [];
  }

  if (!picks.length && candidateCount) {
    picks = salvageHighestRanked(candidates, enrich, requestedLegs);
    failureReason = failureReason ?? "salvage-fallback";
  }

  logCoachFinal("slip-created", {
    requestId,
    pickCount: picks.length,
    failureReason,
    timedOut,
  });

  if (requestId && picks.length) {
    completedHandoffs.add(requestId);
    handoffPickCache.set(requestId, picks);
  }

  return {
    picks,
    failureReason,
    timedOut,
    candidateCount,
    selectedCount: picks.length,
  };
}

/** @deprecated Use executeFinalTicketHandoff */
export function runFinalTicketAssembly(
  input: CoachPipelineFinalizeInput,
): FinalTicketAssemblyResult {
  return executeFinalTicketHandoff(input);
}

export function markFinalTicketMessageAdded(
  requestId: string | undefined,
  pickCount: number,
): void {
  logCoachFinal("message-added", { requestId, pickCount });
}

export function markFinalTicketProgress100(requestId: string | undefined): void {
  logCoachFinal("progress-100", { requestId });
}

export function logFinalTicketMessageCreated(
  requestId: string | undefined,
  pickCount: number,
): void {
  markFinalTicketMessageAdded(requestId, pickCount);
}

export function logFinalTicketCardsRendered(
  requestId: string | undefined,
  cardCount: number,
): void {
  logCoachFinal("cards-rendered", { requestId, cardCount });
}

export function markFinalTicketCardsRendered(
  requestId: string | undefined,
  cardCount: number,
): void {
  logFinalTicketCardsRendered(requestId, cardCount);
}
