// Step 2: fill with highest-rated mains. Step 3: qualifying alts to reach N.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltBoardPick, isAltPropPick, isMainBoardPick, ticketRoleForPick } from "./altLinePool.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import {
  type PartitionedBoardPools,
  partitionPoolPreferringSides,
  interleaveSidesWithProps,
  partitionPropPoolPreferringSideBalance,
  partitionScoredLegsByCategory,
  sidePriorityTiers,
} from "./boardMarketPools.ts";
import {
  BALANCED_BACKFILL_ORDER,
  balancedMixSlots,
  FOOTBALL_BALANCED_MIX_FRACTIONS,
  COLLEGE_FOOTBALL_BALANCED_MIX_FRACTIONS,
  type BoardMarketCategory,
} from "./balancedTicketMix.ts";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import { dedupePicksByMarketLadder, wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import { wouldStackSameTeamTeamTotals } from "./coachP0UnvalidatedTotals.ts";
import {
  selectCorrelationAwareBoardLegs,
  maxLegsPerThinStatMarket,
  isThinPropStatMarket,
  maxLegsPerGame,
  maxPropsPerGame,
  wouldExceedMaxLegsPerGame,
  wouldRepeatPlayerProp,
  wouldExceedMaxPropsPerGame,
  progressiveLegsPerGameRelaxation,
} from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import {
  buildIndependentCoachTicket,
  tieredBackfillStagedTicket,
  type CoachTicketBuildOpts,
} from "./coachTicketCombinations.ts";
import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";
import type { CoachParlayVarietyContext } from "./parlayVarietyMemory.ts";
import {
  pickIsAiRecommended,
  propSimEdgeStagingQualifies,
  qualifiesAltPick,
} from "./pickRecommendation.ts";
import { propQualifiesForTicketFill } from "./propHolisticRecommendation.ts";
import { isHrOnlyScoredPool, selectTopHrQualifiedLegs } from "./coachHrRank.ts";
import {
  boardScanPropSlotCount,
  isFootballHeavyPickList,
} from "./boardScanPropDelivery.ts";

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

/** Lightweight same-team game-line dedupe without React/PickCard runtime imports. */
export function collapseSameTeamGameLineSides(picks: ParsedPick[]): ParsedPick[] {
  const bucketIndex = new Map<string, number>();
  const out: ParsedPick[] = [];
  for (const p of picks) {
    if (!isGameLinePick(p) || p.isProp) {
      out.push(p);
      continue;
    }
    const bucket = gameLineLegBucket(p.game, p.market, p.pick);
    const idx = bucketIndex.get(bucket);
    if (idx == null) {
      bucketIndex.set(bucket, out.length);
      out.push(p);
      continue;
    }
    if (pickRank(p) > pickRank(out[idx]!)) out[idx] = p;
  }
  return out;
}

/** @deprecated internal alias — prefer collapseSameTeamGameLineSides. */
function dedupeSameTeamGameLegsLite(picks: ParsedPick[]): ParsedPick[] {
  return collapseSameTeamGameLineSides(picks);
}

export type BoardScoredLeg = {
  pick: ParsedPick;
  evPct: number | null;
  edgePct: number | null;
  confidencePct: number | null;
  impliedProbPct: number | null;
  lineShoppingScore: number | null;
  grade: string | null;
  simHit: number | null;
  composite: number | null;
  rankScore: number;
  /**
   * 0..1 probability reliability. Rare-count props with thin threshold evidence
   * stay low so raw longshot EV cannot dominate ranking. Defaults to 1.
   */
  hitReliability?: number | null;
};

export function boardLegPoolRole(
  pick: ParsedPick,
  score: ParsedPick["finalAiScore"],
): "main" | "alt" | null {
  if (isMainBoardPick(pick)) {
    if (pickIsAiRecommended(pick, score ?? undefined)) return "main";
    if (pick.isProp && propSimEdgeStagingQualifies(pick, score ?? undefined)) return "main";
    return null;
  }
  if (isAltBoardPick(pick)) {
    return qualifiesAltPick(pick, score ?? undefined) ? "alt" : null;
  }
  if (pickIsAiRecommended(pick, score ?? undefined)) return "main";
  if (qualifiesAltPick(pick, score ?? undefined)) return "alt";
  if (
    pick.isProp &&
    score?.propHolistic &&
    propQualifiesForTicketFill(pick, score.propHolistic, {
      edgePct: score.edgePct,
      simHit: score.simHit,
      odds: pick.odds,
    })
  ) {
    return isAltPropPick(pick) || pick.propIsAlt ? "alt" : "main";
  }
  if (pick.isProp && qualifiesAltPick(pick, score ?? undefined)) {
    return isAltPropPick(pick) || pick.propIsAlt ? "alt" : "main";
  }
  if (propSimEdgeStagingQualifies(pick, score ?? undefined)) {
    return isAltPropPick(pick) || pick.propIsAlt || isAltBoardPick(pick) ? "alt" : "main";
  }
  return null;
}

/** Label each leg main vs alt for ticket gating and ALT PICK badges. */
export function tagTicketRoles(picks: ParsedPick[]): ParsedPick[] {
  return picks.map((p) => ({ ...p, ticketRole: ticketRoleForPick(p) }));
}

/** Greedy top-N by rank — no correlation penalty (used to fill alt gaps to reach N).
 * Still respects max-legs-per-game so top-up cannot re-concentrate on 2 matchups.
 * When `existing` is set (qualified top-up), skip same-team period collapse so
 * Q1+1H+FG seats the raised per-game cap allows are not wiped back to one side.
 */
export function selectGreedyBoardLegs(
  ranked: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  existing: ParsedPick[] = [],
  ticketTarget?: number,
  legsPerGameCap?: number | null,
): ParsedPick[] {
  const seen = new Set(existing.map(pickLegFingerprint));
  const out: ParsedPick[] = [];
  const effectiveTarget = ticketTarget ?? Math.max(target, existing.length + target);
  const maxPerGame = maxLegsPerGame(effectiveTarget, legsPerGameCap);
  const maxProps = maxPropsPerGame(effectiveTarget);
  const sorted = [...ranked].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  for (const row of sorted) {
    const fp = pickLegFingerprint(row.pick);
    if (seen.has(fp)) continue;
    const onTicket = [...existing, ...out];
    if (wouldExceedMaxLegsPerGame(row.pick, onTicket, maxPerGame)) continue;
    if (wouldRepeatPlayerProp(row.pick, onTicket)) continue;
    if (wouldExceedMaxPropsPerGame(row.pick, onTicket, maxProps)) continue;
    if (wouldRepeatMarketLadder(row.pick, onTicket)) continue;
    if (wouldStackSameTeamTeamTotals(row.pick, onTicket)) continue;
    seen.add(fp);
    out.push(row.pick);
    if (out.length >= target) break;
  }
  if (existing.length > 0) return out.slice(0, target);
  return dedupeSameTeamGameLegsLite(out).slice(0, target);
}

/**
 * When combinators leave a short ticket despite more AI-qualified legs on the
 * board, top up greedily from those cleared legs. Never invents ungraded filler.
 *
 * Order matters for football: (1) fill reserved prop seats from leftover props,
 * (2) mixed top-up under the default per-game game-line cap, (3) only then
 * progressively raise the game-line cap for period/alts. Never use #524
 * period-fill to skip past qualified props that still owe seats.
 */
export function topUpTicketFromQualifiedScored(
  picks: ParsedPick[],
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  legsPerGameCap?: number | null,
  opts?: {
    collapseSameTeamSides?: boolean;
    /** College team markets: raise period-stack seat budget on thin slates. */
    collegeTeamMarketStacks?: boolean;
  },
): ParsedPick[] {
  if (target < 3 || picks.length >= target) return picks.slice(0, Math.max(0, target));
  const collapseSameTeam = !!opts?.collapseSameTeamSides;
  const used = new Set(picks.map(pickLegFingerprint));
  const leftover: BoardScoredLeg[] = [];
  for (const leg of scored) {
    const fp = pickLegFingerprint(leg.pick);
    if (used.has(fp)) continue;
    if (boardLegPoolRole(leg.pick, leg.pick.finalAiScore) == null) continue;
    leftover.push(leg);
  }
  if (!leftover.length) return picks.slice(0, target);

  const appendExtras = (
    current: ParsedPick[],
    cap: number | null | undefined,
    poolFilter?: (leg: BoardScoredLeg) => boolean,
  ): ParsedPick[] => {
    const need = target - current.length;
    if (need <= 0) return current;
    const usedNow = new Set(current.map(pickLegFingerprint));
    const pool = leftover.filter((leg) => {
      if (usedNow.has(pickLegFingerprint(leg.pick))) return false;
      return poolFilter ? poolFilter(leg) : true;
    });
    if (!pool.length) return current;
    const extra = selectGreedyBoardLegs(pool, need, varietySeed, current, target, cap);
    if (!extra.length) return current;
    const merged = [...current];
    const usedFp = new Set(current.map(pickLegFingerprint));
    for (const p of extra) {
      const fp = pickLegFingerprint(p);
      if (usedFp.has(fp)) continue;
      // Skip period/same-team legs that would collapse away (keep seat for new teams).
      if (collapseSameTeam) {
        const trial = collapseSameTeamGameLineSides([...merged, p]);
        if (trial.length <= merged.length) continue;
        usedFp.add(fp);
        merged.length = 0;
        merged.push(...trial);
      } else {
        usedFp.add(fp);
        merged.push(p);
      }
      if (merged.length >= target) break;
    }
    return merged;
  };

  // (1) Props-first when qualified props remain and ticket is under the mix floor.
  const propFraction = isFootballHeavyPickList(picks) || isFootballHeavyScoredPool(leftover)
    ? 0.4
    : 0.5;
  const propFloor = boardScanPropSlotCount(target, propFraction);
  let merged = picks.slice();
  if (
    !collapseSameTeam &&
    merged.filter((p) => p.isProp).length < propFloor &&
    leftover.some((l) => l.pick.isProp)
  ) {
    merged = appendExtras(merged, legsPerGameCap, (leg) => !!leg.pick.isProp);
  }

  // (1b) Short-ticket belt: before mixed game-line fill, seat every remaining
  // qualified player prop / + milestone that still clears player / ladder /
  // maxPropsPerGame gates. Does not raise caps or loosen qualification.
  if (
    !collapseSameTeam &&
    merged.length < target &&
    leftover.some((l) => l.pick.isProp)
  ) {
    merged = appendExtras(merged, legsPerGameCap, (leg) => !!leg.pick.isProp);
  }

  // (2) Mixed top-up under the default diversity cap.
  merged = appendExtras(merged, legsPerGameCap);

  // (3) Thin-slate game-line relax — only after props had their chance.
  if (merged.length < target) {
    for (const raised of progressiveLegsPerGameRelaxation(target, legsPerGameCap, {
      collegeTeamMarketStacks: !!opts?.collegeTeamMarketStacks,
    })) {
      const next = appendExtras(merged, raised);
      if (next.length <= merged.length) continue;
      merged = next;
      if (merged.length >= target) break;
    }
  }
  // Mix tickets: do not re-run same-team period collapse on the whole ticket —
  // that would wipe Q1+1H seats the per-game cap intentionally allows.
  // Game-lines-only already collapsed inside appendExtras.
  // Always enforce one rung per normalized market ladder after top-up.
  return tagTicketRoles(dedupePicksByMarketLadder(merged.slice(0, target)));
}

/** Hard cap on niche stat markets so SB stacks cannot dominate a ticket. */
export function capThinStatMarketsOnTicket(picks: ParsedPick[], target: number): ParsedPick[] {
  const maxThin = maxLegsPerThinStatMarket(target);
  const out: ParsedPick[] = [];
  const thinCounts = new Map<string, number>();
  for (const p of picks) {
    if (p.isProp && isThinPropStatMarket(p.market)) {
      const key = p.market.toLowerCase();
      const n = thinCounts.get(key) ?? 0;
      if (n >= maxThin) continue;
      thinCounts.set(key, n + 1);
    }
    out.push(p);
  }
  return out;
}

/** Greedy top-N by rank — correlation-aware when building multi-leg tickets. */
export function selectTopBoardLegs(
  ranked: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  legsPerGameCap?: number | null,
  /** Legs already on the ticket from prior category fills — correlation applies. */
  existing: ParsedPick[] = [],
): ParsedPick[] {
  if (target < 3) {
    return selectGreedyBoardLegs(ranked, target, varietySeed, existing, target, legsPerGameCap);
  }

  const out: ParsedPick[] = [];
  const usedFp = new Set<string>();
  const sorted = [...ranked].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));

  while (out.length < target) {
    const remaining = sorted.filter((r) => !usedFp.has(pickLegFingerprint(r.pick)));
    if (!remaining.length) break;

    const next = selectCorrelationAwareBoardLegs(remaining, 1, {
      ticketTarget: Math.max(target, existing.length + target),
      existing: [...existing, ...out],
      legsPerGameCap,
    });
    if (!next.length) break;

    const pick = next[0]!;
    const fp = pickLegFingerprint(pick);
    const deduped = dedupeSameTeamGameLegsLite([...out, pick]);
    if (deduped.length <= out.length) {
      usedFp.add(fp);
      continue;
    }
    usedFp.add(fp);
    out.length = 0;
    out.push(...deduped);
  }

  if (out.length < target) {
    const usedFpFinal = new Set(out.map(pickLegFingerprint));
    const remaining = sorted.filter((r) => !usedFpFinal.has(pickLegFingerprint(r.pick)));
    const greedy = selectGreedyBoardLegs(
      remaining,
      target - out.length,
      varietySeed,
      [...existing, ...out],
      Math.max(target, existing.length + target),
      legsPerGameCap,
    );
    if (greedy.length) {
      return dedupeSameTeamGameLegsLite([...out, ...greedy]).slice(0, target);
    }
  }

  return out.slice(0, target);
}

/** After thin-market caps, backfill from the qualifying pool so fixed-leg asks don't lose a leg. */
function applyCapAndBackfillToTarget(
  picks: ParsedPick[],
  target: number,
  pool: BoardScoredLeg[],
  legsPerGameCap?: number | null,
): ParsedPick[] {
  let current = capThinStatMarketsOnTicket(picks, target);
  if (current.length >= target) return current.slice(0, target);

  const used = new Set(current.map(pickLegFingerprint));
  const thinOnTicket = current.filter((p) => p.isProp && isThinPropStatMarket(p.market)).length;
  const maxThin = maxLegsPerThinStatMarket(target);
  const maxPerGame = maxLegsPerGame(target, legsPerGameCap);
  const maxProps = maxPropsPerGame(target);
  const ranked = [...pool].sort((a, b) => {
    const aThin = a.pick.isProp && isThinPropStatMarket(a.pick.market) ? 1 : 0;
    const bThin = b.pick.isProp && isThinPropStatMarket(b.pick.market) ? 1 : 0;
    if (thinOnTicket >= maxThin && aThin !== bThin) return aThin - bThin;
    return b.rankScore - a.rankScore;
  });

  for (const row of ranked) {
    if (current.length >= target) break;
    const fp = pickLegFingerprint(row.pick);
    if (used.has(fp)) continue;
    const role = boardLegPoolRole(row.pick, row.pick.finalAiScore);
    if (!role) continue;
    if (wouldExceedMaxLegsPerGame(row.pick, current, maxPerGame)) continue;
    if (wouldRepeatPlayerProp(row.pick, current)) continue;
    if (wouldExceedMaxPropsPerGame(row.pick, current, maxProps)) continue;
    if (wouldRepeatMarketLadder(row.pick, current)) continue;
    if (wouldStackSameTeamTeamTotals(row.pick, current)) continue;
    const trial = capThinStatMarketsOnTicket(
      [...current, { ...row.pick, ticketRole: role, highRiskValuePlay: false }],
      target,
    );
    if (trial.length > current.length) {
      current = trial;
      used.add(fp);
    }
  }

  // Second pass: prefer non-thin markets when SB cap left the ticket short.
  if (current.length < target) {
    const thinOnTicket = current.filter((p) => p.isProp && isThinPropStatMarket(p.market)).length;
    const nonThin = ranked.filter((row) => {
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) return false;
      if (thinOnTicket >= maxThin && row.pick.isProp && isThinPropStatMarket(row.pick.market)) {
        return false;
      }
      if (wouldExceedMaxLegsPerGame(row.pick, current, maxPerGame)) return false;
      if (wouldRepeatPlayerProp(row.pick, current)) return false;
      if (wouldExceedMaxPropsPerGame(row.pick, current, maxProps)) return false;
      if (wouldRepeatMarketLadder(row.pick, current)) return false;
      if (wouldStackSameTeamTeamTotals(row.pick, current)) return false;
      return boardLegPoolRole(row.pick, row.pick.finalAiScore) != null;
    });
    for (const row of nonThin) {
      if (current.length >= target) break;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
      if (wouldExceedMaxLegsPerGame(row.pick, current, maxPerGame)) continue;
      if (wouldRepeatPlayerProp(row.pick, current)) continue;
      if (wouldExceedMaxPropsPerGame(row.pick, current, maxProps)) continue;
      if (wouldRepeatMarketLadder(row.pick, current)) continue;
      if (wouldStackSameTeamTeamTotals(row.pick, current)) continue;
      const role = boardLegPoolRole(row.pick, row.pick.finalAiScore)!;
      const trial = capThinStatMarketsOnTicket(
        [...current, { ...row.pick, ticketRole: role, highRiskValuePlay: false }],
        target,
      );
      if (trial.length > current.length) {
        current = trial;
        used.add(fp);
      }
    }
  }

  return current;
}

function qualifyingScoredLegs(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  return scored.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null);
}

function appendPicksFromPool(
  out: ParsedPick[],
  used: Set<string>,
  pool: BoardScoredLeg[],
  want: number,
  target: number,
  varietySeed?: string,
  preferSides = false,
  balancePropSides = false,
): number {
  if (want <= 0) return 0;
  // Exclude fingerprints already seated AND correlated ladder rungs already on
  // the ticket (props vs alternateLines pools can hold the same player/side).
  const remaining = pool.filter((row) => {
    if (used.has(pickLegFingerprint(row.pick))) return false;
    if (wouldRepeatMarketLadder(row.pick, out)) return false;
    if (wouldStackSameTeamTeamTotals(row.pick, out)) return false;
    return true;
  });
  const pickFrom = (candidates: BoardScoredLeg[], n: number): ParsedPick[] => {
    if (n <= 0 || !candidates.length) return [];
    // Pass existing ticket so correlation-aware selection sees prior category fills.
    return target >= 3
      ? selectTopBoardLegs(candidates, n, varietySeed, undefined, out)
      : selectGreedyBoardLegs(candidates, n, varietySeed, out, target);
  };

  // Sides-first: fill reserved game-line / alt slots from spreads & ML before
  // FG/F5/alt totals so rank re-sort inside selectTopBoardLegs cannot flood O/U.
  // Tiered FG → period → heavy-juice so re-sort cannot promote Q4/-415 over FG.
  let picks: ParsedPick[];
  if (preferSides) {
    const { rest } = partitionPoolPreferringSides(remaining);
    const picked: ParsedPick[] = [];
    const usedLocal = new Set<string>();
    for (const tier of [...sidePriorityTiers(remaining), rest]) {
      const need = want - picked.length;
      if (need <= 0) break;
      const avail = tier.filter((row) => !usedLocal.has(pickLegFingerprint(row.pick)));
      const batch = pickFrom(avail, need);
      for (const p of batch) {
        usedLocal.add(pickLegFingerprint(p));
        picked.push(p);
      }
    }
    picks = picked;
  } else if (balancePropSides && want >= 2) {
    // Soft Under reservation among qualified props — does not invent Unders.
    const { unders, overs, other } = partitionPropPoolPreferringSideBalance(remaining);
    const underWant = Math.min(unders.length, Math.floor(want / 2));
    const fromUnders = pickFrom(unders, underWant);
    const usedLocal = new Set(fromUnders.map(pickLegFingerprint));
    const need = want - fromUnders.length;
    const restPool = [...overs, ...other].filter(
      (row) => !usedLocal.has(pickLegFingerprint(row.pick)),
    );
    picks = [...fromUnders, ...pickFrom(restPool, need)];
  } else {
    picks = pickFrom(remaining, want);
  }

  let added = 0;
  for (const p of picks) {
    const fp = pickLegFingerprint(p);
    if (used.has(fp)) continue;
    const role = boardLegPoolRole(p, p.finalAiScore);
    if (!role) continue;
    used.add(fp);
    out.push({ ...p, ticketRole: role, highRiskValuePlay: false });
    added += 1;
  }
  return added;
}

/** Props-first backfill — strict pool first; tiered relax only when still short of target. */
function applyBalancedCapAndBackfill(
  picks: ParsedPick[],
  target: number,
  pools: PartitionedBoardPools,
  varietySeed?: string,
  allScored?: BoardScoredLeg[],
  ticketStyle?: CoachTicketStyle,
): ParsedPick[] {
  let current = capThinStatMarketsOnTicket(picks, target);
  if (current.length >= target) return current.slice(0, target);

  const used = new Set(current.map(pickLegFingerprint));
  for (const cat of BALANCED_BACKFILL_ORDER) {
    if (current.length >= target) break;
    const orderedPools =
      cat === "gameLines" || cat === "alternateLines"
        ? (() => {
            const { rest } = partitionPoolPreferringSides(pools[cat]);
            return [...sidePriorityTiers(pools[cat]), rest];
          })()
        : [pools[cat]];
    for (const sub of orderedPools) {
      const ranked = [...sub].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
      for (const row of ranked) {
        if (current.length >= target) break;
        const fp = pickLegFingerprint(row.pick);
        if (used.has(fp)) continue;
        if (wouldRepeatMarketLadder(row.pick, current)) continue;
        if (wouldStackSameTeamTeamTotals(row.pick, current)) continue;
        const role = boardLegPoolRole(row.pick, row.pick.finalAiScore);
        if (!role) continue;
        const trial = capThinStatMarketsOnTicket(
          [...current, { ...row.pick, ticketRole: role, highRiskValuePlay: false }],
          target,
        );
        if (trial.length > current.length) {
          current = trial;
          used.add(fp);
        }
      }
    }
  }
  if (allScored?.length && ticketStyle && current.length < target) {
    current = tieredBackfillStagedTicket(current, target, allScored, ticketStyle, varietySeed);
  }
  return current;
}

/** Balanced ticket: ~50% props, ~25% game lines, ~5% team totals, ~20% alts. */

const FOOTBALL_SPORTS = new Set(["nfl", "ncaaf"]);

function isFootballHeavyScoredPool(scored: BoardScoredLeg[]): boolean {
  let football = 0;
  let total = 0;
  for (const leg of scored) {
    const s = String(leg.pick.sport ?? "").toLowerCase();
    if (!s) continue;
    total += 1;
    if (FOOTBALL_SPORTS.has(s)) football += 1;
  }
  return total > 0 && football / total >= 0.6;
}

export function buildBalancedStagedTicketFromScan(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  ticketStyle: CoachTicketStyle = "balanced",
  opts?: { collegeTeamMarketStacks?: boolean },
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = qualifyingScoredLegs(scored);
  const pools = partitionScoredLegsByCategory(qualifying);
  const ncaafN = qualifying.filter(
    (l) => String(l.pick.sport ?? "").toLowerCase() === "ncaaf",
  ).length;
  const collegeHeavy =
    !!opts?.collegeTeamMarketStacks ||
    (qualifying.length > 0 && ncaafN >= Math.ceil(qualifying.length * 0.6));
  const fractions = collegeHeavy
    ? COLLEGE_FOOTBALL_BALANCED_MIX_FRACTIONS
    : isFootballHeavyScoredPool(qualifying)
      ? FOOTBALL_BALANCED_MIX_FRACTIONS
      : undefined;
  const slots = balancedMixSlots(target, fractions, { floorTeamTotals: collegeHeavy });
  const used = new Set<string>();
  const out: ParsedPick[] = [];

  // Prefer spreads/ML ahead of FG/F5 totals inside game-line + alt pools so
  // mix tickets are not flooded with Over/Under totals when sides also qualify.
  appendPicksFromPool(out, used, pools.props, slots.props, target, varietySeed, false, true);
  appendPicksFromPool(
    out,
    used,
    pools.gameLines,
    slots.gameLines,
    target,
    varietySeed,
    true,
  );
  appendPicksFromPool(out, used, pools.teamTotals, slots.teamTotals, target, varietySeed);
  appendPicksFromPool(
    out,
    used,
    pools.alternateLines,
    slots.alternateLines,
    target,
    varietySeed,
    true,
  );

  const finalPicks = interleaveSidesWithProps(
    applyBalancedCapAndBackfill(
      out,
      target,
      pools,
      varietySeed,
      scored,
      ticketStyle,
    ).slice(0, target),
  );
  const mains = qualifying.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "main");
  const alts = qualifying.filter((leg) => boardLegPoolRole(leg.pick, leg.pick.finalAiScore) === "alt");

  return {
    picks: finalPicks,
    breakdown: {
      mainQualified: mains.length,
      altQualified: alts.length,
      mainOnTicket: finalPicks.filter((p) => p.ticketRole === "main").length,
      altOnTicket: finalPicks.filter((p) => p.ticketRole === "alt").length,
    },
  };
}

export type CoachTicketStagingContext = Partial<CoachParlayVarietyContext> & {
  ticketStyle?: CoachTicketStyle;
  legsPerGameCap?: number | null;
  collegeTeamMarketStacks?: boolean;
};

/** Stage a ticket from scored legs — fair rank competition (no mains-first seat priority). */
export function buildStagedTicketFromScan(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  varietyContext?: CoachTicketStagingContext,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const ticketStyle = varietyContext?.ticketStyle ?? "balanced";

  // Home-run-only boards: evaluate full ranked pool, take top-N distinct hitters
  // by HRScore. Same-game stacks only when they independently rank in the top N.
  // Quality bar unchanged — shortfall returns fewer legs (no filler).
  if (isHrOnlyScoredPool(scored)) {
    const picks = selectTopHrQualifiedLegs(scored, target);
    const mainQualified = scored.filter(
      (l) => boardLegPoolRole(l.pick, l.pick.finalAiScore) === "main",
    ).length;
    const altQualified = scored.filter(
      (l) => boardLegPoolRole(l.pick, l.pick.finalAiScore) === "alt",
    ).length;
    return {
      picks,
      breakdown: {
        mainQualified,
        altQualified,
        mainOnTicket: picks.filter((p) => p.ticketRole === "main").length,
        altOnTicket: picks.filter((p) => p.ticketRole === "alt").length,
      },
    };
  }

  if (target >= 3 && varietySeed) {
    return buildIndependentCoachTicket(scored, target, {
      varietySeed,
      ticketStyle,
      ...varietyContext,
    } satisfies CoachTicketBuildOpts);
  }
  if (target >= 3) {
    return buildBalancedStagedTicketFromScan(scored, target, varietySeed, ticketStyle, {
      collegeTeamMarketStacks: varietyContext?.collegeTeamMarketStacks,
    });
  }

  // Fair competition: all qualifying legs compete by validated rankScore.
  // ticketRole (main/alt) is a badge only — not a seating priority.
  const qualifying: BoardScoredLeg[] = [];
  for (const leg of scored) {
    const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
    if (role === "main" || role === "alt") qualifying.push(leg);
  }
  qualifying.sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));

  const selected = (
    target >= 3
      ? selectTopBoardLegs(qualifying, target, varietySeed)
      : selectGreedyBoardLegs(qualifying, target, varietySeed)
  ).map((p) => {
    const role = boardLegPoolRole(p, p.finalAiScore) ?? "main";
    return {
      ...p,
      ticketRole: role,
      highRiskValuePlay: false,
    };
  });

  let finalPicks = applyCapAndBackfillToTarget(selected.slice(0, target), target, qualifying);
  if (finalPicks.length < target) {
    finalPicks = tieredBackfillStagedTicket(finalPicks, target, scored, ticketStyle, varietySeed);
  }
  const mainQualified = qualifying.filter(
    (l) => boardLegPoolRole(l.pick, l.pick.finalAiScore) === "main",
  ).length;
  const altQualified = qualifying.filter(
    (l) => boardLegPoolRole(l.pick, l.pick.finalAiScore) === "alt",
  ).length;
  return {
    picks: finalPicks,
    breakdown: {
      mainQualified,
      altQualified,
      mainOnTicket: finalPicks.filter((p) => p.ticketRole === "main").length,
      altOnTicket: finalPicks.filter((p) => p.ticketRole === "alt").length,
    },
  };
}
