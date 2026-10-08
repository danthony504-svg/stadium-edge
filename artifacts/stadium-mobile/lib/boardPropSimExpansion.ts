// Progressive board prop sim — prescore entire pool, run MC on every candidate.

import type { ParsedPick } from "../components/PickCard.tsx";
import { collapseScoredLegsByMarketLadder, marketLadderKey } from "./marketLadderExhaustion.ts";
import { dedupePicksByMarketLadder } from "./marketLadderKey.ts";
import { marketSupportsSimulation } from "./simMarketSupport.ts";
import { buildStagedTicketFromScan, type BoardScoredLeg } from "./ticketStaging.ts";
import {
  FOOTBALL_DST_PROP_SIM_CAP,
  isFootballDstPropMarket,
} from "./footballDstProps.ts";
import { isUnsupportedQbRushOverHalf } from "./coachPropIntegrityGates.ts";

export const BOARD_PROP_SIM_BATCH = 21;

/** Props with a posted price and a supported sim model — eligible for board MC. */
export function isRealisticBoardPropCandidate(pick: ParsedPick): boolean {
  if (!pick.isProp) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds) || pick.odds === 0) return false;
  if (pick.propLine == null || !Number.isFinite(pick.propLine) || !pick.propSide) return false;
  if (isUnsupportedQbRushOverHalf(pick)) return false;
  return marketSupportsSimulation(pick.market ?? "", pick);
}

/**
 * How many unique legs can fill the ticket right now — ladder-collapsed so duplicate
 * alt rungs on the same player/market do not inflate the count and stop prop sim early.
 */
export function countQualifiedBoardLegs(scored: BoardScoredLeg[], target: number): number {
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  const { picks } = buildStagedTicketFromScan(collapsed, target);
  // Belt-and-suspenders: correlated alt/main rungs never inflate fill counts.
  return dedupePicksByMarketLadder(picks).length;
}

/** First prop-sim wave — wide enough to surface early qualifiers quickly. */
export function boardPropSimInitialBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, target * 2);
}

/** Later waves while still short of the leg target. */
export function boardPropSimExpansionBatchSize(target: number): number {
  return Math.max(BOARD_PROP_SIM_BATCH, Math.min(84, target * 4));
}

/**
 * Football mix batches — fewer round-trips so the priority skill set finishes
 * inside the mix deadline (wide batches, still under the per-batch timeout).
 */
export function boardPropSimMixBatchSize(target: number): number {
  return Math.max(32, Math.min(64, target * 5));
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
  return dedupePicksByMarketLadder(picks).filter((p) => !!p.isProp).length;
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

/**
 * Floor share of the mixed/generic deep-sim set reserved for alternate props
 * when enough alts exist — prevents main O/U from exhausting the ≤96 budget.
 * Does not raise the cap; does not force unsupported markets.
 */
export const BOARD_PROP_SIM_ALT_QUOTA_FRACTION = 0.3;

export type FootballMixSimFamily = "yards" | "td" | "volume" | "other";

function isAltSimCandidate(pick: { propIsAlt?: boolean; market?: string | null }): boolean {
  if (pick.propIsAlt) return true;
  return /\balt\b/i.test(String(pick.market ?? ""));
}

/**
 * Within one correlation ladder, prefer main + nearest + farthest posted lines
 * so milestone thresholds still reach deep sim inside the 3-rung budget.
 */
export function pickDiverseLadderRungsForSim<T extends {
  propLine?: number | null;
  propIsAlt?: boolean;
  market?: string | null;
}>(rungs: readonly T[], maxRungs: number): T[] {
  if (maxRungs <= 0 || rungs.length === 0) return [];
  if (rungs.length <= maxRungs) return [...rungs];
  const mains = rungs.filter((r) => !isAltSimCandidate(r));
  const alts = rungs.filter((r) => isAltSimCandidate(r));
  const mainLine =
    mains.find((r) => r.propLine != null)?.propLine ??
    rungs.find((r) => r.propLine != null)?.propLine ??
    null;
  const altsByDist = [...alts].sort((a, b) => {
    const da = a.propLine != null && mainLine != null ? Math.abs(a.propLine - mainLine) : 0;
    const db = b.propLine != null && mainLine != null ? Math.abs(b.propLine - mainLine) : 0;
    return da - db;
  });
  const picked: T[] = [];
  const used = new Set<T>();
  const take = (r: T | undefined) => {
    if (!r || used.has(r) || picked.length >= maxRungs) return;
    used.add(r);
    picked.push(r);
  };
  take(mains[0]);
  take(altsByDist[0]);
  take(altsByDist[altsByDist.length - 1]);
  for (const r of rungs) {
    if (picked.length >= maxRungs) break;
    take(r);
  }
  return picked;
}

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
 * Football mix / props-only NFL rebuild: deep-sim with family quotas so TD spam
 * cannot consume the entire cap before pass/rec/rush yards get Monte Carlo.
 * Prefer athleteId rows — missing ids drove phone PROP_ALL_NO_SIM_GRADE
 * (500 deep-simmed, 0 grades) when local fallback could not resolve history.
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

  // Floors scale with the finishable mix cap (was hard 48/24/16 for a 360 set).
  const yardsQuota = Math.max(12, Math.round(maxToSim * 0.45));
  const tdQuota = Math.max(8, Math.round(maxToSim * 0.25));
  const volumeQuota = Math.max(6, Math.round(maxToSim * 0.15));

  const buckets: Record<FootballMixSimFamily, T[]> = {
    yards: [],
    td: [],
    volume: [],
    other: [],
  };
  for (const pick of rankedProps) {
    buckets[footballMixSimFamily(pick)].push(pick);
  }
  // AthleteId-first inside each family so enrich/local MC can grade.
  for (const fam of Object.keys(buckets) as FootballMixSimFamily[]) {
    buckets[fam].sort((a, b) => {
      const aId = a.athleteId ? 1 : 0;
      const bId = b.athleteId ? 1 : 0;
      return bId - aId;
    });
  }

  const altFloor = Math.min(
    maxToSim,
    Math.max(0, Math.round(maxToSim * BOARD_PROP_SIM_ALT_QUOTA_FRACTION)),
  );
  const selected: T[] = [];
  const ladderCounts = new Map<string, number>();
  let dstTaken = 0;
  let altTaken = 0;

  const tryTake = (pick: T): boolean => {
    if (selected.length >= maxToSim) return false;
    const dst = isFootballDstPropMarket(pick.propMarketKey ?? pick.market);
    if (dst && dstTaken >= FOOTBALL_DST_PROP_SIM_CAP) return false;
    const ladder = marketLadderKey(pick);
    const used = ladderCounts.get(ladder) ?? 0;
    if (used >= BOARD_PROP_SIM_RUNGS_PER_LADDER) return false;
    ladderCounts.set(ladder, used + 1);
    selected.push(pick);
    if (dst) dstTaken += 1;
    if (isAltSimCandidate(pick)) altTaken += 1;
    return true;
  };

  const takeFrom = (list: T[], limit: number, preferAlt?: boolean) => {
    const ordered = preferAlt
      ? [...list].sort((a, b) => Number(isAltSimCandidate(b)) - Number(isAltSimCandidate(a)))
      : list;
    let left = limit;
    for (const pick of ordered) {
      if (selected.length >= maxToSim || left <= 0) return;
      if (tryTake(pick)) left -= 1;
    }
  };

  // Within each family: reserve ~30% of that family's quota for alts first.
  const takeFamilyWithAltFloor = (list: T[], quota: number) => {
    if (quota <= 0 || list.length === 0) return;
    const famAltFloor = Math.min(quota, Math.round(quota * BOARD_PROP_SIM_ALT_QUOTA_FRACTION));
    const byLadder = new Map<string, T[]>();
    for (const p of list) {
      const k = marketLadderKey(p);
      const arr = byLadder.get(k) ?? [];
      arr.push(p);
      byLadder.set(k, arr);
    }
    const diverse: T[] = [];
    for (const rungs of byLadder.values()) {
      diverse.push(...pickDiverseLadderRungsForSim(rungs, BOARD_PROP_SIM_RUNGS_PER_LADDER));
    }
    const diverseAlts = diverse.filter((p) => isAltSimCandidate(p));
    const diverseMains = diverse.filter((p) => !isAltSimCandidate(p));
    const before = selected.length;
    const remaining = () => Math.max(0, quota - (selected.length - before));
    takeFrom(diverseAlts, Math.min(famAltFloor, remaining()), true);
    takeFrom(diverseMains, remaining(), false);
    takeFrom(diverse, remaining(), false);
  };

  takeFamilyWithAltFloor(buckets.yards, yardsQuota);
  takeFamilyWithAltFloor(buckets.td, tdQuota);
  takeFamilyWithAltFloor(buckets.volume, volumeQuota);
  takeFamilyWithAltFloor(buckets.other, maxToSim - selected.length);

  // Global alt floor: if still short on alts, pull remaining alts within cap.
  if (altTaken < altFloor && selected.length < maxToSim) {
    const taken = new Set(selected);
    const moreAlts = rankedProps.filter((p) => isAltSimCandidate(p) && !taken.has(p));
    takeFrom(moreAlts, altFloor - altTaken, true);
  }
  if (selected.length < maxToSim) {
    const taken = new Set(selected);
    for (const fam of ["yards", "volume", "td", "other"] as const) {
      for (const pick of buckets[fam]) {
        if (selected.length >= maxToSim) break;
        if (taken.has(pick)) continue;
        tryTake(pick);
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
 * True when Coach should use the finishable football skill deep-sim path.
 * Covers "10 leg nfl" mix AND "9 leg NFL player props" (props-only) — the
 * generic 500-row board path was PROP_ALL_NO_SIM_GRADE on phone.
 */
export function shouldUseFootballSkillPropSim(opts: {
  requirePropMix?: boolean;
  propsOnly?: boolean;
  pool: readonly { sport?: string | null }[];
}): boolean {
  if (opts.requirePropMix) return true;
  if (!opts.propsOnly || opts.pool.length === 0) return false;
  let football = 0;
  let total = 0;
  for (const p of opts.pool) {
    const s = String(p.sport ?? "").toLowerCase();
    if (!s) continue;
    total += 1;
    if (s === "nfl" || s === "ncaaf") football += 1;
  }
  return total > 0 && football / total >= 0.5;
}

/**
 * Pre-rank + soft ladder-dedupe before deep MC. Keeps up to
 * BOARD_PROP_SIM_RUNGS_PER_LADDER posted lines per player/market so alt
 * yard/attempt/completion numbers (150 / 175 / …) still get simulated, then
 * fills remaining slots from deferred rungs. Qualification thresholds unchanged.
 * D/ST props are hard-capped so tackle/kicking volume cannot inflate the set.
 */
export function selectBoardPropSimCandidates<T extends ParsedPick>(
  rankedProps: readonly T[],
  maxToSim: number,
): { selected: T[]; skippedCount: number } {
  if (maxToSim <= 0 || rankedProps.length === 0) {
    return { selected: [], skippedCount: rankedProps.length };
  }

  const altFloor = Math.min(
    maxToSim,
    Math.max(0, Math.round(maxToSim * BOARD_PROP_SIM_ALT_QUOTA_FRACTION)),
  );
  const selected: T[] = [];
  const ladderCounts = new Map<string, number>();
  let dstTaken = 0;
  let altTaken = 0;

  const tryTake = (pick: T): boolean => {
    if (selected.length >= maxToSim) return false;
    const dst = isFootballDstPropMarket(pick.propMarketKey ?? pick.market);
    if (dst && dstTaken >= FOOTBALL_DST_PROP_SIM_CAP) return false;
    const ladder = marketLadderKey(pick);
    const used = ladderCounts.get(ladder) ?? 0;
    if (used >= BOARD_PROP_SIM_RUNGS_PER_LADDER) return false;
    ladderCounts.set(ladder, used + 1);
    selected.push(pick);
    if (dst) dstTaken += 1;
    if (isAltSimCandidate(pick)) altTaken += 1;
    return true;
  };

  // Group by correlation ladder, pick diverse rungs, then fill with alt floor.
  const byLadder = new Map<string, T[]>();
  for (const pick of rankedProps) {
    const k = marketLadderKey(pick);
    const arr = byLadder.get(k) ?? [];
    arr.push(pick);
    byLadder.set(k, arr);
  }
  const diversePool: T[] = [];
  for (const rungs of byLadder.values()) {
    diversePool.push(...pickDiverseLadderRungsForSim(rungs, BOARD_PROP_SIM_RUNGS_PER_LADDER));
  }
  // Preserve original rank order among diverse picks.
  const rankIndex = new Map(rankedProps.map((p, i) => [p, i]));
  diversePool.sort((a, b) => (rankIndex.get(a) ?? 0) - (rankIndex.get(b) ?? 0));

  const alts = diversePool.filter((p) => isAltSimCandidate(p));
  const mains = diversePool.filter((p) => !isAltSimCandidate(p));
  for (const pick of alts) {
    if (altTaken >= altFloor) break;
    tryTake(pick);
  }
  for (const pick of mains) {
    if (selected.length >= maxToSim) break;
    tryTake(pick);
  }
  for (const pick of diversePool) {
    if (selected.length >= maxToSim) break;
    tryTake(pick);
  }
  // Remaining ranked rows (beyond diverse set) if cap not full.
  if (selected.length < maxToSim) {
    const taken = new Set(selected);
    for (const pick of rankedProps) {
      if (selected.length >= maxToSim) break;
      if (taken.has(pick)) continue;
      tryTake(pick);
    }
  }

  return { selected, skippedCount: rankedProps.length - selected.length };
}
