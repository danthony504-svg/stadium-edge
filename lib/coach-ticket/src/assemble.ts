import {
  COACH_MAX_PARLAY_LEGS,
  COACH_MIN_PARLAY_LEGS,
  type CoachScanManifest,
  type CoachTicket,
  type CoachTicketResponse,
} from "@workspace/coach-types";
import { buildAltLadderIndex } from "@workspace/coach-alts";
import type { CoachRankedPool } from "@workspace/coach-rank";
import { rankedLegsInTicketOrder } from "@workspace/coach-rank";

import { toPickDisplay } from "./display";
import { buildShortfallReason } from "./shortfall";
import { selectTicketLegs } from "./select";

export type AssembleCoachTicketOptions = {
  ranked: CoachRankedPool;
  manifest: CoachScanManifest;
  requestedLegs: number;
  nowMs?: number;
  sportFilter?: string | null;
  refreshing?: boolean;
};

function clampRequestedLegs(requested: number): number {
  const rounded = Math.floor(requested);
  if (!Number.isFinite(rounded)) return COACH_MIN_PARLAY_LEGS;
  return Math.max(COACH_MIN_PARLAY_LEGS, Math.min(COACH_MAX_PARLAY_LEGS, rounded));
}

function filterBySport(legs: ReturnType<typeof rankedLegsInTicketOrder>, sport: string | null | undefined) {
  if (!sport) return legs;
  const key = sport.toLowerCase();
  return legs.filter((leg) => String(leg.sport).toLowerCase() === key);
}

export function assembleCoachTicket(opts: AssembleCoachTicketOptions): CoachTicket {
  const requestedLegs = clampRequestedLegs(opts.requestedLegs);
  const ordered = filterBySport(rankedLegsInTicketOrder(opts.ranked), opts.sportFilter);
  const ladderIndex = buildAltLadderIndex(ordered);
  const { picks } = selectTicketLegs(ladderIndex.champions, requestedLegs);

  const propCount = picks.filter((p) => p.kind === "player_prop").length;
  const gameLineCount = picks.length - propCount;

  return {
    requestedLegs,
    deliveredLegs: picks.length,
    picks: picks.map(toPickDisplay),
    propCount,
    gameLineCount,
    assembledAt: new Date(opts.nowMs ?? Date.now()).toISOString(),
  };
}

export function assembleCoachTicketResponse(
  opts: AssembleCoachTicketOptions,
): CoachTicketResponse {
  const ticket = assembleCoachTicket(opts);
  const propsQualified = opts.ranked.props.length;
  const gameLinesQualified = opts.ranked.gameLines.length;

  const shortfall =
    ticket.deliveredLegs < ticket.requestedLegs
      ? buildShortfallReason(
          opts.manifest,
          ticket.requestedLegs,
          ticket.deliveredLegs,
          propsQualified,
          gameLinesQualified,
        )
      : null;

  return {
    ticket,
    shortfall,
    ready: opts.manifest.scanComplete,
    deepSimComplete: opts.manifest.deepSimComplete,
    manifest: opts.manifest,
    refreshing: opts.refreshing ?? false,
  };
}

/** Invariant: delivered legs must all have passed gates (positive edge). */
export function assertTicketInvariants(ticket: CoachTicket): void {
  if (ticket.deliveredLegs !== ticket.picks.length) {
    throw new Error("deliveredLegs must equal picks.length");
  }
  if (ticket.deliveredLegs > ticket.requestedLegs) {
    throw new Error("cannot deliver more legs than requested");
  }
  for (const pick of ticket.picks) {
    if (pick.edgePct <= 0) {
      throw new Error(`ticket contains non-positive edge pick: ${pick.pick}`);
    }
  }
}
