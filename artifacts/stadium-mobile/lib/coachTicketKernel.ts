// Single Coach ticket pipeline — every delivery path must pass through here.
// Parlay builds use board-scan / server slate only (see coachParlayEngine.ts).

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  rescoreCoachTicketPreservingLegs,
  topUpCoachTicketToTarget,
} from "./coachTicketRescore.ts";
import { stripFillerBackfillPicks } from "./coachScanPolicy.ts";
import { filterCoachHorizonPicksAfterEnrich } from "./slate.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import { enforceConsistentPropSides } from "./propSideConsistency.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import {
  coachBoardScanTicketPicks,
  coachPreserveStagedBoardPicks,
} from "./pickRecommendation.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";

export type CoachTicketKernelOpts = {
  enrich: CoachFlashEnrich;
  legTarget?: number;
  boardMeta?: FullBoardScanResult | null;
};

/** Hard invariants: horizon, one side per game, prop sides, rescoring. */
export function applyCoachTicketKernel(
  ticket: ParsedPick[],
  opts: CoachTicketKernelOpts,
): ParsedPick[] {
  const { enrich, legTarget = 0, boardMeta } = opts;
  if (!ticket.length) return [];

  let rescored = rescoreCoachTicketPreservingLegs(tagTicketRoles(ticket), enrich);
  const pool = boardMeta?.picks?.length ? tagTicketRoles([...boardMeta.picks]) : [];
  if (legTarget >= 3 && pool.length && rescored.length < legTarget) {
    rescored = topUpCoachTicketToTarget(rescored, legTarget, pool, enrich);
  }

  let cleaned = stripFillerBackfillPicks(rescored);
  cleaned = filterCoachHorizonPicksAfterEnrich(cleaned, enrich);
  cleaned = finalizeCoachDeliveryPicks(cleaned, {
    simByGame: enrich.gameSimulations,
    matchupHistory: enrich.matchupHistory,
  });
  return enforceConsistentPropSides(cleaned).picks;
}

/** Board-scan partial → display-ready ticket (staging gates + kernel). */
export function boardScanToCoachTicket(
  partial: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  legTarget?: number,
): ParsedPick[] {
  if (!partial.picks.length) return [];

  const tagged = tagTicketRoles([...partial.picks]);
  const preserved = coachPreserveStagedBoardPicks(tagged, enrich);
  const staged = preserved.length > 0 ? preserved : coachBoardScanTicketPicks(tagged, enrich);
  if (!staged.length) return [];

  return applyCoachTicketKernel(staged, {
    enrich,
    legTarget,
    boardMeta: partial,
  });
}
