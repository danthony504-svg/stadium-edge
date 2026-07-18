// Final ticket assembly — single-shot handoff after correlation with 5s deadline.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  finalizeCoachPipelineTickets,
  type CoachPipelineFinalizeInput,
} from "./coachPipelineFinalize.ts";
import { isActiveCoachRun } from "./coachRunTrace.ts";
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

export function resetCoachFinalHandoffForTests(): void {
  completedHandoffs.clear();
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

/**
 * Run final ticket assembly exactly once per requestId after correlation completes.
 * Never returns empty when candidates exist.
 */
export function executeFinalTicketHandoff(
  input: CoachPipelineFinalizeInput,
): FinalTicketAssemblyResult {
  const { requestId, candidates, requestedLegs } = input;
  const candidateCount = candidates.length;

  if (requestId && completedHandoffs.has(requestId)) {
    logCoachFinal("assembly-start", { requestId, skipped: true, reason: "already-finalized" });
    return {
      picks: [],
      failureReason: "already-finalized",
      timedOut: false,
      skipped: true,
      candidateCount,
      selectedCount: 0,
    };
  }

  if (requestId && !isActiveCoachRun(requestId)) {
    logCoachFinal("assembly-start", { requestId, stale: true });
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

  const start = Date.now();
  let failureReason: string | null = null;
  let timedOut = false;
  let picks: ParsedPick[] = [];

  try {
    const pipeline = finalizeCoachPipelineTickets({
      ...input,
      relaxCorrelation: input.relaxCorrelation ?? true,
    });
    logCoachFinal("dedupe-complete", {
      requestId,
      candidateCount,
      selectedCount: pipeline.selectedCount,
    });
    logCoachFinal("alternates-complete", {
      requestId,
      selectedCount: pipeline.selectedCount,
      salvageUsed: pipeline.salvageUsed,
    });
    picks = pipeline.picks;

    if (!picks.length && candidateCount) {
      failureReason = "strict-gates-zeroed-candidates";
      picks = salvageHighestRanked(candidates, input.enrich, requestedLegs);
    }
  } catch (err) {
    failureReason = err instanceof Error ? err.message : "final-assembly-error";
    picks = candidateCount
      ? salvageHighestRanked(candidates, input.enrich, requestedLegs)
      : [];
  }

  const elapsed = Date.now() - start;
  if (elapsed > FINAL_TICKET_ASSEMBLY_DEADLINE_MS) {
    timedOut = true;
    failureReason = failureReason ?? "final-assembly-timeout";
    if (!picks.length && candidateCount) {
      picks = salvageHighestRanked(candidates, input.enrich, requestedLegs);
    }
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn(
        `[coach-final] assembly exceeded ${FINAL_TICKET_ASSEMBLY_DEADLINE_MS}ms — salvage picks used`,
        { requestId, elapsed, pickCount: picks.length },
      );
    }
  }

  if (!picks.length && candidateCount) {
    picks = salvageHighestRanked(candidates, input.enrich, requestedLegs);
    failureReason = failureReason ?? "salvage-fallback";
  }

  logCoachFinal("slip-created", {
    requestId,
    pickCount: picks.length,
    failureReason,
    timedOut,
    elapsedMs: elapsed,
  });

  if (requestId && picks.length) {
    completedHandoffs.add(requestId);
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
