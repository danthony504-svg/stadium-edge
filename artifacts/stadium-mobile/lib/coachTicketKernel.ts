// Coach ticket kernel v2 — invariants only (horizon + dedupe). No re-gating staged legs.

import type { ParsedPick } from "../components/PickCard.tsx";
import { stripFillerBackfillPicks } from "./coachScanPolicy.ts";
import {
  enrichPicksWithStartsAt,
  filterCoachHorizonPicksAfterEnrich,
  preferBettableQualifiedPicks,
} from "./slate.ts";
import { finalizeCoachDeliveryPicks } from "./ticketDiversity.ts";
import { enforceConsistentPropSides } from "./propSideConsistency.ts";
import { tagTicketRoles } from "./ticketStaging.ts";
import type { CoachFlashEnrich } from "./pickScoreContext.ts";
import type { FullBoardScanResult } from "./boardMarketScanner.ts";
import { filterCoachDeliveredPicks } from "./pickRecommendation.ts";

export type CoachTicketKernelOpts = {
  enrich: CoachFlashEnrich;
  legTarget?: number;
  boardMeta?: FullBoardScanResult | null;
};

function dedupeOpts(enrich: CoachFlashEnrich) {
  return {
    simByGame: enrich.gameSimulations,
    matchupHistory: enrich.matchupHistory,
  };
}

/**
 * Apply only hard invariants: horizon, one team per game, prop-side consistency.
 * Does NOT re-run staging / holistic / AI recommendation gates.
 */
export function applyCoachTicketInvariants(
  picks: ParsedPick[],
  enrich: CoachFlashEnrich,
): ParsedPick[] {
  if (!picks.length) return [];

  let out = stripFillerBackfillPicks(picks);
  const enriched = enrichPicksWithStartsAt(out, enrich);
  out = filterCoachHorizonPicksAfterEnrich(enriched, enrich);
  if (!out.length && enriched.length) {
    out = preferBettableQualifiedPicks(enriched);
  }
  if (!out.length && picks.length) {
    out = stripFillerBackfillPicks(picks);
  }

  out = finalizeCoachDeliveryPicks(out, dedupeOpts(enrich));
  if (!out.length && picks.length) {
    out = finalizeCoachDeliveryPicks(stripFillerBackfillPicks(picks), dedupeOpts(enrich));
  }
  return enforceConsistentPropSides(out).picks;
}

/** Final delivery gate — invariants + positive edge / AI-rec filter. Use on every write to message state. */
export function prepareCoachDeliveredTicket(
  picks: ParsedPick[],
  enrich: CoachFlashEnrich,
): ParsedPick[] {
  if (!picks.length) return [];
  const tagged = tagTicketRoles(picks);
  return filterCoachDeliveredPicks(applyCoachTicketInvariants(tagged, enrich), enrich);
}

/** Display guard — lightweight dedupe only; never rescore or re-gate. */
export function coerceCoachDisplayPicks(
  picks: ParsedPick[],
  enrich?: CoachTicketKernelOpts["enrich"],
): ParsedPick[] {
  if (!picks.length) return picks;
  const base = enrich ?? { realOdds: [], propPool: [], gameMeta: [] };
  const cleaned = applyCoachTicketInvariants(picks, base);
  return cleaned.length ? cleaned : picks;
}

/** Board scan → ticket: trust staged scan picks, apply invariants, fail-soft. */
export function boardScanToCoachTicket(
  partial: FullBoardScanResult,
  enrich: CoachFlashEnrich,
  _legTarget?: number,
): ParsedPick[] {
  if (!partial.picks.length) return [];
  const tagged = tagTicketRoles([...partial.picks]);
  const ticket = applyCoachTicketInvariants(tagged, enrich);
  return ticket.length ? ticket : coerceCoachDisplayPicks(tagged, enrich);
}

/** @deprecated Use applyCoachTicketInvariants — kept for deliverCoachTicket rescore path. */
export function applyCoachTicketKernel(
  ticket: ParsedPick[],
  opts: CoachTicketKernelOpts,
): ParsedPick[] {
  return applyCoachTicketInvariants(ticket, opts.enrich);
}
