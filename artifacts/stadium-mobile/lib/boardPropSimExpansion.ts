// Progressive board prop sim — prescore entire pool, deep-sim a ranked/deduped subset.

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketLadderKey, collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";
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

/**
 * Pre-rank + ladder-dedupe before deep MC. Keeps the best-ranked rung per market
 * ladder first, then fills remaining slots with next-best candidates. Does not
 * change qualification thresholds — only which rows reach the 10k deep stage.
 */
export function selectBoardPropSimCandidates<T extends ParsedPick>(
  rankedProps: readonly T[],
  maxToSim: number,
): { selected: T[]; skippedCount: number } {
  if (maxToSim <= 0 || rankedProps.length === 0) {
    return { selected: [], skippedCount: rankedProps.length };
  }
  if (rankedProps.length <= maxToSim) {
    return { selected: [...rankedProps], skippedCount: 0 };
  }

  const selected: T[] = [];
  const seenLadder = new Set<string>();
  const deferred: T[] = [];

  for (const pick of rankedProps) {
    const ladder = marketLadderKey(pick);
    if (!seenLadder.has(ladder)) {
      seenLadder.add(ladder);
      selected.push(pick);
      if (selected.length >= maxToSim) {
        return { selected, skippedCount: rankedProps.length - selected.length };
      }
    } else {
      deferred.push(pick);
    }
  }

  for (const pick of deferred) {
    selected.push(pick);
    if (selected.length >= maxToSim) break;
  }

  return { selected, skippedCount: rankedProps.length - selected.length };
}

/** First prop-sim wave — wide enough to surface early qualifiers quickly. */
export function boardPropSimInitialBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, target * 2);
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, Math.min(84, target * 4));
}
