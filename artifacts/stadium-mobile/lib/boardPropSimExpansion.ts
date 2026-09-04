// Progressive board prop sim — prescore entire pool, run MC on every candidate.

import type { ParsedPick } from "./parsedPick.ts";
import { collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";

export const BOARD_PROP_SIM_BATCH = 21;

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
export function countQualifiedBoardLegs(scored: BoardScoredLeg[], target: number): number {
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  const { picks } = buildStagedTicketFromScan(collapsed, target);
  return picks.length;
}

/** First prop-sim wave — small enough to finish within the 12s quick-tier batch budget. */
export function boardPropSimInitialBatchSize(target: number): number {
  if (target >= 15) return 12;
  if (target >= 9) return 14;
  return Math.min(BOARD_PROP_SIM_BATCH, Math.max(10, target * 2));
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  if (target >= 15) return 14;
  if (target >= 9) return 16;
  return Math.min(BOARD_PROP_SIM_BATCH, Math.max(12, target * 3));
}
