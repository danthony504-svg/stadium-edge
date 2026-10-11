// Progressive board prop sim — prescore entire pool, run MC on every candidate.

import type { ParsedPick } from "../components/PickCard.tsx";
import { collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import {
  buildStagedTicketFromScan,
  type BoardScoredLeg,
  type CoachTicketStagingContext,
} from "./ticketStaging.ts";

export const BOARD_PROP_SIM_BATCH = 21;

/**
 * Extra staged seats beyond the requested target before early-stop.
 * Absorbs correlation / ladder / one-player / seating attrition after MC.
 * Not a raw qualified-count pad — staging must seat this many.
 */
export function boardPropSimEarlyStopReserve(target: number): number {
  return Math.max(2, Math.ceil(target * 0.3));
}

/** Props with a posted price and a supported sim model — eligible for board MC. */
export function isRealisticBoardPropCandidate(pick: ParsedPick): boolean {
  if (!pick.isProp) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (pick.propLine == null || !Number.isFinite(pick.propLine) || !pick.propSide) return false;
  return marketSupportsSimulation(pick.market ?? "", pick);
}

/**
 * How many unique legs can fill the ticket right now — ladder-collapsed so duplicate
 * alt rungs on the same player/market do not inflate the count and stop prop sim early.
 */
export function countQualifiedBoardLegs(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  varietyContext?: CoachTicketStagingContext,
): number {
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  const { picks } = buildStagedTicketFromScan(collapsed, target, varietySeed, varietyContext);
  return picks.length;
}

export type BoardPropSimFillCapacity = {
  /** True when staging can seat target + reserve distinct non-conflicting legs. */
  ready: boolean;
  seated: number;
  need: number;
  reserve: number;
  target: number;
};

/**
 * Staging-aware fill capacity for early-stop. Uses the same ticket builder as final
 * delivery (ladder collapse → correlation / one-player / seating rules), asking for
 * target + reserve seats — never raw qualified count alone.
 */
export function boardPropSimFillCapacity(
  scored: BoardScoredLeg[],
  target: number,
  opts?: {
    varietySeed?: string;
    varietyContext?: CoachTicketStagingContext;
    /** Override reserve; default boardPropSimEarlyStopReserve(target). */
    reserve?: number;
  },
): BoardPropSimFillCapacity {
  const reserve = opts?.reserve ?? boardPropSimEarlyStopReserve(target);
  const need = target + reserve;
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  const { picks } = buildStagedTicketFromScan(
    collapsed,
    need,
    opts?.varietySeed,
    opts?.varietyContext,
  );
  return {
    ready: picks.length >= need,
    seated: picks.length,
    need,
    reserve,
    target,
  };
}

/** First prop-sim wave — wide enough to surface early qualifiers quickly. */
export function boardPropSimInitialBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, target * 2);
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, Math.min(84, target * 4));
}
