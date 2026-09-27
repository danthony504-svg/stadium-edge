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
  /**
   * When true (e.g. home-run board asks), keep simulating every eligible
   * candidate — do not stop after the first N qualify.
   */
  exhaustPropBoard?: boolean;
}): boolean {
  if (opts.exhaustPropBoard) return false;
  const qualified = countQualifiedBoardLegs(opts.scored, opts.target);
  if (qualified < opts.target) return false;
  if (opts.propsOnly) return true;
  const propSlots = boardPropSlotTarget(opts.target);
  if (propSlots <= 0) return true;
  return countStagedPropLegs(opts.scored, opts.target) >= propSlots;
}

/** How many posted lines per player/market to deep-sim (main + alt numbers). */
export const BOARD_PROP_SIM_RUNGS_PER_LADDER = 3;

export type FootballMixSimFamily = "yards" | "td" | "volume" | "other";

/** Bucket for football mix deep-sim quotas — yards must not be starved by TD rows. */
export function footballMixSimFamily(pick: {
  market?: string | null;
  propMarketKey?: string | null;
}): FootballMixSimFamily {
  const m = String(pick.propMarketKey ?? pick.market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return "other";
  if (/\btd\b|touchdown|\btds\b/.test(m)) return "td";
  if (/yd|yard/.test(m) && /\b(pass|rush|rec|reception|receiving)\b/.test(m)) {
    return "yards";
  }
  if (
    /\breceptions?\b|\battacks?\b|\battempts?\b|\bcompletions?\b|\bpass\s*attempts?\b|\brush\s*attempts?\b/.test(
      m,
    )
  ) {
    return "volume";
  }
  return "other";
}

/**
 * Football mix rebuild: deep-sim with family quotas so TD spam cannot consume
 * the entire cap before pass/rec/rush yards get Monte Carlo.
 * Order within each family follows the caller's ranking.
 */
export function selectFootballMixPropSimCandidates<T extends ParsedPick>(
  rankedProps: readonly T[],
  maxToSim: number,
): { selected: T[]; skippedCount: number; familyCounts: Record<FootballMixSimFamily, number> } {
  const emptyCounts: Record<FootballMixSimFamily, number> = {
    yards: 0,
    td: 0,
    volume: 0,
    other: 0,
  };
  if (maxToSim <= 0 || rankedProps.length === 0) {
    return {
      selected: [],
      skippedCount: rankedProps.length,
      familyCounts: emptyCounts,
    };
  }

  const yardsQuota = Math.max(48, Math.round(maxToSim * 0.45));
  const tdQuota = Math.max(24, Math.round(maxToSim * 0.25));
  const volumeQuota = Math.max(16, Math.round(maxToSim * 0.15));

  const buckets: Record<FootballMixSimFamily, T[]> = {
    yards: [],
    td: [],
    volume: [],
    other: [],
  };
  for (const pick of rankedProps) {
    buckets[footballMixSimFamily(pick)].push(pick);
  }

  const selected: T[] = [];
  const ladderCounts = new Map<string, number>();
  const takeFrom = (list: T[], limit: number) => {
    for (const pick of list) {
      if (selected.length >= maxToSim || limit <= 0) return;
      const ladder = marketLadderKey(pick);
      const used = ladderCounts.get(ladder) ?? 0;
      if (used >= BOARD_PROP_SIM_RUNGS_PER_LADDER) continue;
      ladderCounts.set(ladder, used + 1);
      selected.push(pick);
      limit -= 1;
    }
  };

  takeFrom(buckets.yards, yardsQuota);
  takeFrom(buckets.td, tdQuota);
  takeFrom(buckets.volume, volumeQuota);
  takeFrom(buckets.other, maxToSim - selected.length);
  if (selected.length < maxToSim) {
    const taken = new Set(selected);
    for (const fam of ["yards", "volume", "td", "other"] as const) {
      for (const pick of buckets[fam]) {
        if (selected.length >= maxToSim) break;
        if (taken.has(pick)) continue;
        const ladder = marketLadderKey(pick);
        const used = ladderCounts.get(ladder) ?? 0;
        if (used >= BOARD_PROP_SIM_RUNGS_PER_LADDER) continue;
        ladderCounts.set(ladder, used + 1);
        selected.push(pick);
        taken.add(pick);
      }
    }
  }

  const familyCounts = { ...emptyCounts };
  for (const pick of selected) {
    familyCounts[footballMixSimFamily(pick)] += 1;
  }
  return {
    selected,
    skippedCount: rankedProps.length - selected.length,
    familyCounts,
  };
}

/**
 * Pre-rank + soft ladder-dedupe before deep MC. Keeps up to
 * BOARD_PROP_SIM_RUNGS_PER_LADDER posted lines per player/market so alt
 * yard/attempt/completion numbers (150 / 175 / …) still get simulated, then
 * fills remaining slots from deferred rungs. Qualification thresholds unchanged.
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
  const ladderCounts = new Map<string, number>();
  const deferred: T[] = [];

  for (const pick of rankedProps) {
    const ladder = marketLadderKey(pick);
    const used = ladderCounts.get(ladder) ?? 0;
    if (used < BOARD_PROP_SIM_RUNGS_PER_LADDER) {
      ladderCounts.set(ladder, used + 1);
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
