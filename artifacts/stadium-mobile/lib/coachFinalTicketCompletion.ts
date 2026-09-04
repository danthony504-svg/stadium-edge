// Final-ticket completion after correlation — immediate card delivery, no background waits.

import type { ParsedPick } from "../components/PickCard.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { deliverCoachBoardScanTicket } from "./coachBoardScanDelivery.ts";
import {
  executeFinalTicketHandoff,
  logCoachFinal,
  salvageHighestRanked,
} from "./coachFinalTicketAssembly.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import { COACH_EMPTY_BOARD_SCAN_LEAD } from "./coachBoardScanDelivery.ts";

export type CoachFinalTicketCompletionPhase =
  | "correlation-complete"
  | "board-scan-complete"
  | "patch-instant"
  | "deadline-fallback"
  | "completed"
  | "no-valid-picks";

export type CoachFinalTicketCompletionResult = {
  requestId: string;
  requestedLegs: number;
  candidateCount: number;
  selectedCount: number;
  messageCount: number;
  phase: CoachFinalTicketCompletionPhase;
  picks: ParsedPick[];
  coachDetailNote: string;
  outcome: "cards" | "no-valid-picks";
  fallbackUsed: boolean;
};

export function coachFinalTicketNoValidPicksMessage(): string {
  return COACH_EMPTY_BOARD_SCAN_LEAD;
}

export function logCoachFinalizationState(opts: {
  requestId: string;
  requestedLegs: number;
  candidateCount: number;
  selectedCount: number;
  messageCount: number;
  phase: string;
}): void {
  console.log("[coach-final]", JSON.stringify(opts));
}

/** Runs immediately after correlation completes — never blocks on background work. */
export function resolveCoachFinalTicketAfterCorrelation(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
  opts: {
    requestId: string;
    messageCount: number;
    phase: CoachFinalTicketCompletionPhase;
  },
): CoachFinalTicketCompletionResult {
  const candidateCount = scan.picks?.length ?? 0;
  const base = {
    requestId: opts.requestId,
    requestedLegs: legTarget,
    candidateCount,
    messageCount: opts.messageCount,
    phase: opts.phase,
    coachDetailNote: "",
    fallbackUsed: false,
  };

  if (!candidateCount) {
    const result: CoachFinalTicketCompletionResult = {
      ...base,
      selectedCount: 0,
      picks: [],
      outcome: "no-valid-picks",
      phase: "no-valid-picks",
    };
    logCoachFinalizationState({
      requestId: opts.requestId,
      requestedLegs: legTarget,
      candidateCount: 0,
      selectedCount: 0,
      messageCount: opts.messageCount,
      phase: "no-valid-picks",
    });
    return result;
  }

  const assembly = executeFinalTicketHandoff({
    requestId: opts.requestId,
    candidates: scan.picks,
    enrich,
    requestedLegs: legTarget,
    relaxCorrelation: true,
  });

  const delivered = deliverCoachBoardScanTicket(scan, enrich, legTarget);
  let picks = assembly.picks.length ? assembly.picks : delivered.picks;
  let fallbackUsed = assembly.timedOut || !!assembly.failureReason;

  if (!picks.length) {
    picks = salvageHighestRanked(scan.picks, enrich, legTarget);
    fallbackUsed = true;
  }

  const selectedCount = picks.length;
  const phase: CoachFinalTicketCompletionPhase =
    selectedCount > 0 ? "completed" : "no-valid-picks";
  const coachDetailNote = delivered.coachDetailNote || base.coachDetailNote;

  logCoachFinalizationState({
    requestId: opts.requestId,
    requestedLegs: legTarget,
    candidateCount,
    selectedCount,
    messageCount: opts.messageCount,
    phase,
  });

  if (fallbackUsed && selectedCount > 0) {
    logCoachFinal("fallback-used", {
      requestId: opts.requestId,
      selectedCount,
      candidateCount,
    });
  }

  return {
    ...base,
    selectedCount,
    picks,
    coachDetailNote,
    outcome: selectedCount > 0 ? "cards" : "no-valid-picks",
    phase,
    fallbackUsed,
  };
}

/** Deadline salvage — highest-ranked candidates up to leg target. */
export function resolveCoachFinalTicketFallback(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
  opts: {
    requestId: string;
    messageCount: number;
  },
): CoachFinalTicketCompletionResult {
  const candidateCount = scan.picks?.length ?? 0;
  const picks = candidateCount
    ? salvageHighestRanked(scan.picks, enrich, legTarget)
    : [];

  logCoachFinal("fallback-used", {
    requestId: opts.requestId,
    candidateCount,
    selectedCount: picks.length,
    legTarget,
  });

  const phase: CoachFinalTicketCompletionPhase =
    picks.length > 0 ? "completed" : "no-valid-picks";

  logCoachFinalizationState({
    requestId: opts.requestId,
    requestedLegs: legTarget,
    candidateCount,
    selectedCount: picks.length,
    messageCount: opts.messageCount,
    phase: picks.length > 0 ? "deadline-fallback" : "no-valid-picks",
  });

  return {
    requestId: opts.requestId,
    requestedLegs: legTarget,
    candidateCount,
    selectedCount: picks.length,
    messageCount: opts.messageCount,
    phase,
    picks,
    coachDetailNote: "",
    outcome: picks.length > 0 ? "cards" : "no-valid-picks",
    fallbackUsed: true,
  };
}
