// Parlay builds: server slate + board scan only — never LLM-parsed legs.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { boardScanIsComplete, boardScanMeetsLegTarget } from "./coachScanPolicy.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import {
  applyCoachTicketInvariants,
  boardScanToCoachTicket,
} from "./coachTicketKernel.ts";
import { tagTicketRoles } from "./ticketStaging.ts";

export const COACH_PARLAY_KERNEL_ONLY = true;

export type CoachParlayKernelResult = {
  ticket: ParsedPick[];
  legNote?: string;
  source: "board-scan" | "slate-seed" | "none";
};

export function coachParlayKernelSkipStream(opts: {
  isParlayBuild: boolean;
  isAnalyze: boolean;
  hasOutgoingImages: boolean;
  oddsThreshold: boolean;
  confidenceThreshold: boolean;
}): boolean {
  if (!COACH_PARLAY_KERNEL_ONLY) return false;
  if (!opts.isParlayBuild || opts.isAnalyze) return false;
  if (opts.hasOutgoingImages) return false;
  if (opts.oddsThreshold || opts.confidenceThreshold) return false;
  return true;
}

export function resolveCoachParlayKernelTicket(opts: {
  scan: FullBoardScanResult | null | undefined;
  enrich: CoachFlashEnrich;
  legTarget: number;
}): CoachParlayKernelResult {
  const { scan, enrich, legTarget } = opts;
  if (!scan?.picks?.length) {
    return { ticket: [], source: "none" };
  }

  const ticket = boardScanToCoachTicket(scan, enrich, legTarget);
  if (!ticket.length && scan.picks.length) {
    return {
      ticket: applyCoachTicketInvariants(tagTicketRoles([...scan.picks]), enrich),
      legNote: scan.note,
      source: "board-scan",
    };
  }
  if (!ticket.length) {
    return { ticket: [], source: "none" };
  }

  let legNote = scan.note;
  if (legTarget > ticket.length) {
    legNote = boardScanIsComplete(scan)
      ? legNote
      : `You asked for **${legTarget}** legs — showing **${ticket.length}** from the scored board.`;
  }

  return {
    ticket,
    legNote,
    source: boardScanMeetsLegTarget(scan, legTarget) ? "slate-seed" : "board-scan",
  };
}
