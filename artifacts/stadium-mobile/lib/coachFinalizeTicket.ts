// Single Coach final-ticket finalizer — only path that may complete a request.

import type { ParsedPick } from "../components/PickCard.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { COACH_EMPTY_BOARD_SCAN_LEAD, deliverCoachBoardScanTicket } from "./coachBoardScanDelivery.ts";
import { boardScanIsComplete } from "./coachScanPolicy.ts";
import { coerceCoachDisplayPicks } from "./coachTicketKernel.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import { finalizeBoardBuiltCoachTicket } from "./pickRecommendation.ts";
import { tagTicketRoles } from "./ticketStaging.ts";

export const COACH_FINALIZE_DEADLINE_MS = 5000;

export type FinalizeCoachTicketInput = {
  requestId: string;
  candidates: readonly ParsedPick[];
  requestedLegs: number;
  enrich: CoachFlashEnrich;
  scan?: FullBoardScanResult | null;
};

export type FinalizeCoachTicketResult = {
  requestId: string;
  requestedLegs: number;
  candidateCount: number;
  selectedCount: number;
  picks: ParsedPick[];
  coachDetailNote: string;
  outcome: "completed" | "no-valid-picks";
  fallbackUsed: boolean;
};

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

function salvageCandidates(
  candidates: readonly ParsedPick[],
  enrich: CoachFlashEnrich,
  legTarget: number,
): ParsedPick[] {
  const ranked = [...candidates].sort((a, b) => pickRank(b) - pickRank(a));
  const coerced = coerceCoachDisplayPicks(ranked, enrich);
  const pool = coerced.length ? coerced : ranked;
  return legTarget > 0 ? pool.slice(0, legTarget) : pool;
}

function selectFromScan(
  scan: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget: number,
): { picks: ParsedPick[]; coachDetailNote: string } {
  const delivered = deliverCoachBoardScanTicket(scan, enrich, legTarget);
  if (delivered.picks.length) {
    return { picks: delivered.picks, coachDetailNote: delivered.coachDetailNote };
  }
  const tagged = tagTicketRoles([...scan.picks]);
  const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
  const picks =
    finalized.picks.length > 0
      ? legTarget > 0
        ? finalized.picks.slice(0, legTarget)
        : finalized.picks
      : salvageCandidates(scan.picks, enrich, legTarget);
  return { picks, coachDetailNote: delivered.coachDetailNote };
}

export function logCoachFinalizeTicket(payload: {
  requestId: string;
  requestedLegs: number;
  candidateCount: number;
  selectedCount: number;
  messageCount: number;
  phase: string;
}): void {
  console.log("[coach-final]", JSON.stringify(payload));
}

/**
 * Choose final picks from correlated candidates and mark the request ready to render.
 * UI layers must call this once per requestId, then apply picks to messages/slip.
 */
export function finalizeCoachTicket(input: FinalizeCoachTicketInput): FinalizeCoachTicketResult {
  const { requestId, candidates, requestedLegs, enrich, scan } = input;
  const candidateCount = candidates.length;
  const legTarget = requestedLegs > 0 ? requestedLegs : candidateCount;

  if (!candidateCount) {
    return {
      requestId,
      requestedLegs: legTarget,
      candidateCount: 0,
      selectedCount: 0,
      picks: [],
      coachDetailNote: COACH_EMPTY_BOARD_SCAN_LEAD,
      outcome: "no-valid-picks",
      fallbackUsed: false,
    };
  }

  let picks: ParsedPick[] = [];
  let coachDetailNote = "";
  let fallbackUsed = false;

  if (scan && boardScanIsComplete(scan)) {
    const fromScan = selectFromScan(scan, enrich, legTarget);
    picks = fromScan.picks;
    coachDetailNote = fromScan.coachDetailNote;
  }

  if (!picks.length) {
    const tagged = tagTicketRoles([...candidates]);
    const finalized = finalizeBoardBuiltCoachTicket(tagged, enrich);
    picks = finalized.picks.length
      ? legTarget > 0
        ? finalized.picks.slice(0, legTarget)
        : finalized.picks
      : salvageCandidates(candidates, enrich, legTarget);
    fallbackUsed = !finalized.picks.length;
  }

  if (!picks.length) {
    picks = salvageCandidates(candidates, enrich, legTarget);
    fallbackUsed = true;
  }

  const selectedCount = picks.length;
  return {
    requestId,
    requestedLegs: legTarget,
    candidateCount,
    selectedCount,
    picks,
    coachDetailNote,
    outcome: selectedCount > 0 ? "completed" : "no-valid-picks",
    fallbackUsed,
  };
}
