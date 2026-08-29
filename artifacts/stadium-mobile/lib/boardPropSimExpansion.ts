// Progressive board prop sim — prescore entire pool, run MC on every candidate.

import type { ParsedPick } from "../components/PickCard.tsx";
import { collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";
import { isYesNoPropMarket, simulationLineForProp } from "./propYesNoMarkets.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";

export const BOARD_PROP_SIM_BATCH = 21;

/** Props with a posted price and a supported sim model — eligible for board MC. */
export function isRealisticBoardPropCandidate(pick: ParsedPick): boolean {
  if (!pick.isProp) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (simulationLineForProp(pick.propMarketKey ?? pick.market, pick.propLine) == null) return false;
  if (!pick.propSide && !isYesNoPropMarket(pick.propMarketKey ?? pick.market)) return false;
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

/** First prop-sim wave — wide enough to surface early qualifiers quickly. */
export function boardPropSimInitialBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, target * 2);
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, Math.min(84, target * 4));
}
