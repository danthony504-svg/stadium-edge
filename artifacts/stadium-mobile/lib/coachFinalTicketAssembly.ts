// Final ticket assembly — 5s deadline, salvage on failure, staged logging.

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
};

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

function salvageHighestRanked(
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
 * Run final ticket assembly immediately after correlation completes.
 * Never returns empty when candidates exist.
 */
export function runFinalTicketAssembly(
  input: CoachPipelineFinalizeInput,
): FinalTicketAssemblyResult {
  const { requestId, candidates, requestedLegs } = input;

  if (requestId && !isActiveCoachRun(requestId)) {
    console.log("[final-ticket] start", { requestId, stale: true });
    return { picks: [], failureReason: "stale-request", timedOut: false };
  }

  console.log("[final-ticket] start", {
    requestId,
    requestedLegs,
    deadlineMs: FINAL_TICKET_ASSEMBLY_DEADLINE_MS,
  });
  console.log("[final-ticket] candidates", {
    requestId,
    count: candidates.length,
  });

  const deadline = Date.now() + FINAL_TICKET_ASSEMBLY_DEADLINE_MS;
  let failureReason: string | null = null;
  let timedOut = false;
  let picks: ParsedPick[] = [];

  try {
    const result = finalizeCoachPipelineTickets(input);
    picks = result.picks;
    if (Date.now() > deadline) {
      timedOut = true;
      failureReason = "final-assembly-timeout";
    }
    if (!picks.length && candidates.length) {
      failureReason = failureReason ?? "strict-gates-zeroed-candidates";
      picks = salvageHighestRanked(candidates, input.enrich, requestedLegs);
    }
  } catch (err) {
    failureReason = err instanceof Error ? err.message : "final-assembly-error";
    picks = candidates.length
      ? salvageHighestRanked(candidates, input.enrich, requestedLegs)
      : [];
  }

  if (!picks.length && candidates.length) {
    picks = salvageHighestRanked(candidates, input.enrich, requestedLegs);
    failureReason = failureReason ?? "salvage-fallback";
  }

  console.log("[final-ticket] selected", {
    requestId,
    requested: requestedLegs,
    selected: picks.length,
    failureReason,
    timedOut,
  });

  return { picks, failureReason, timedOut };
}

export function logFinalTicketMessageCreated(
  requestId: string | undefined,
  pickCount: number,
): void {
  console.log("[final-ticket] message-created", { requestId, pickCount });
}

export function logFinalTicketCardsRendered(
  requestId: string | undefined,
  cardCount: number,
): void {
  console.log("[final-ticket] cards-rendered", { requestId, cardCount });
}
