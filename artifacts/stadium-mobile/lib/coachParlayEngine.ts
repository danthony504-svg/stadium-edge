// Parlay builds: server slate + board scan only — never LLM-parsed legs.

import type { ParsedPick } from "./parsedPick.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { deliverCoachBoardScanTicket } from "./coachBoardScanDelivery.ts";
import { boardScanIsComplete, boardScanMeetsLegTarget, boardScanReadyForDelivery } from "./coachScanPolicy.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";

export const COACH_PARLAY_KERNEL_ONLY = true;

export type CoachParlayKernelResult = {
  ticket: ParsedPick[];
  legNote?: string;
  coachDetailNote?: string;
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
  if (!scan || !boardScanIsComplete(scan)) {
    return { ticket: [], source: "none" };
  }

  const delivered = deliverCoachBoardScanTicket(scan, enrich, legTarget);
  if (!delivered.picks.length) {
    return {
      ticket: [],
      coachDetailNote: delivered.coachDetailNote,
      source: "board-scan",
    };
  }

  let legNote = scan.note;
  if (legTarget > delivered.picks.length) {
    legNote = scan.note;
  }

  return {
    ticket: delivered.picks,
    legNote,
    coachDetailNote: delivered.coachDetailNote,
    source: boardScanReadyForDelivery(scan, legTarget) ? "board-scan" : "slate-seed",
  };
}
