// Progressive board prop sim — prescore entire pool, run MC on every candidate.

import type { ParsedPick } from "../components/PickCard.tsx";
import { collapseScoredLegsByMarketLadder, marketLadderKey } from "./marketLadderExhaustion.ts";
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

/** First prop-sim wave — wide enough to surface early qualifiers quickly. */
export function boardPropSimInitialBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, target * 2);
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, Math.min(84, target * 4));
}


/** ~50% of N-leg tickets reserved for player props (matches preview reserve). */
export function boardPropSlotTarget(target: number): number {
  if (target < 3) return 0;
  return Math.max(1, Math.round(target * 0.5));
}

/** Prop count on the staged ticket (ladder-collapsed). */
export function countStagedPropLegs(scored: BoardScoredLeg[], target: number): number {
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  const { picks } = buildStagedTicketFromScan(collapsed, target);
  return picks.filter((p) => !!p.isProp).length;
}

/**
 * Stop deep prop MC once the ticket can paint at full size with the reserved
 * prop mix. Do NOT stop on game-line-only fill — that skipped props and locked
 * game-line-only tickets.
 */
export function shouldStopPropSimForTicketMix(opts: {
  scored: BoardScoredLeg[];
  target: number;
  propsOnly?: boolean;
}): boolean {
  const qualified = countQualifiedBoardLegs(opts.scored, opts.target);
  if (qualified < opts.target) return false;
  if (opts.propsOnly) return true;
  const propSlots = boardPropSlotTarget(opts.target);
  if (propSlots <= 0) return true;
  return countStagedPropLegs(opts.scored, opts.target) >= propSlots;
}

/**
 * Pre-rank + ladder-dedupe before deep MC. Keeps the best-ranked rung per market
 * ladder first, then fills remaining slots. Does not change qualification
 * thresholds — only which rows reach deep sim.
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
