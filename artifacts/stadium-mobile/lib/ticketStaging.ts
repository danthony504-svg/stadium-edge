// Step 2: fill with highest-rated mains. Step 3: qualifying alts to reach N.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltBoardPick, isAltPropPick, isMainBoardPick, ticketRoleForPick } from "./altLinePool.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import {
  type PartitionedBoardPools,
  partitionScoredLegsByCategory,
} from "./boardMarketPools.ts";
import {
  BALANCED_BACKFILL_ORDER,
  balancedMixSlots,
  type BoardMarketCategory,
} from "./balancedTicketMix.ts";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import { selectCorrelationAwareBoardLegs, maxLegsPerThinStatMarket, isThinPropStatMarket } from "./parlayCorrelationScore.ts";
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
  correlationTimedOut,
  logCoachScanLineValueComplete,
  logCoachScanLineValueStart,
  shouldSkipCorrelationScoring,
  correlationDeadline,
} from "./coachScanPipeline.ts";
import { runCoachCorrelationStage } from "./coachCorrelationPipeline.ts";
import {
  pickIsAiRecommended,
  propSimEdgeStagingQualifies,
  qualifiesAltPick,
} from "./pickRecommendation.ts";
import { propQualifiesForTicketFill } from "./propHolisticRecommendation.ts";

function pickRank(p: ParsedPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? 0;
}

/** Lightweight same-team game-line dedupe without React/PickCard runtime imports. */
function dedupeSameTeamGameLegsLite(picks: ParsedPick[]): ParsedPick[] {
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

/** Greedy top-N by rank — no correlation penalty (used to fill alt gaps to reach N). */
export function selectGreedyBoardLegs(
  ranked: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): ParsedPick[] {
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  const sorted = [...ranked].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  for (const row of sorted) {
    const fp = pickLegFingerprint(row.pick);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(row.pick);
    if (out.length >= target) break;
  }
  return dedupeSameTeamGameLegsLite(out).slice(0, target);
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
  deadlineAt?: number,
): ParsedPick[] {
  if (target < 3) return selectGreedyBoardLegs(ranked, target, varietySeed);

  const out: ParsedPick[] = [];
  const usedFp = new Set<string>();
  const sorted = [...ranked].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  let stallRounds = 0;
  const maxRounds = Math.max(target * 4, sorted.length * 2);
  let rounds = 0;

  while (out.length < target && rounds < maxRounds) {
    rounds += 1;
    if (deadlineAt != null && correlationTimedOut(deadlineAt)) break;

    const remaining = sorted.filter((r) => !usedFp.has(pickLegFingerprint(r.pick)));
    if (!remaining.length) break;

    const next = selectCorrelationAwareBoardLegs(remaining, 1);
    if (!next.length) break;

    const pick = next[0]!;
    const fp = pickLegFingerprint(pick);
    const deduped = dedupeSameTeamGameLegsLite([...out, pick]);
    if (deduped.length <= out.length) {
      usedFp.add(fp);
      stallRounds += 1;
      if (stallRounds >= remaining.length) break;
      continue;
    }
    stallRounds = 0;
    usedFp.add(fp);
    out.length = 0;
    out.push(...deduped);
  }

  if (out.length < target) {
    const usedFpFinal = new Set(out.map(pickLegFingerprint));
    const remaining = sorted.filter((r) => !usedFpFinal.has(pickLegFingerprint(r.pick)));
    const greedy = selectGreedyBoardLegs(remaining, target - out.length, varietySeed);
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
): ParsedPick[] {
  let current = capThinStatMarketsOnTicket(picks, target);
  if (current.length >= target) return current.slice(0, target);

  const used = new Set(current.map(pickLegFingerprint));
  const thinOnTicket = current.filter((p) => p.isProp && isThinPropStatMarket(p.market)).length;
  const maxThin = maxLegsPerThinStatMarket(target);
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
      return boardLegPoolRole(row.pick, row.pick.finalAiScore) != null;
    });
    for (const row of nonThin) {
      if (current.length >= target) break;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
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
  deadlineAt?: number,
): number {
  if (want <= 0) return 0;
  const remaining = pool.filter((row) => !used.has(pickLegFingerprint(row.pick)));
  const picks =
    target >= 3
      ? selectTopBoardLegs(remaining, want, varietySeed, deadlineAt)
      : selectGreedyBoardLegs(remaining, want, varietySeed);
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
    const ranked = [...pools[cat]].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
    for (const row of ranked) {
      if (current.length >= target) break;
      const fp = pickLegFingerprint(row.pick);
      if (used.has(fp)) continue;
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
  if (allScored?.length && ticketStyle && current.length < target) {
    current = tieredBackfillStagedTicket(current, target, allScored, ticketStyle, varietySeed);
  }
  return current;
}

/** Balanced ticket: ~50% props, ~25% game lines, ~12.5% team totals, ~12.5% alts. */
export function buildBalancedStagedTicketFromScan(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  ticketStyle: CoachTicketStyle = "balanced",
  deadlineAt?: number,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const qualifying = qualifyingScoredLegs(scored);
  const pools = partitionScoredLegsByCategory(qualifying);
  const slots = balancedMixSlots(target);
  const used = new Set<string>();
  const out: ParsedPick[] = [];

  appendPicksFromPool(out, used, pools.props, slots.props, target, varietySeed, deadlineAt);
  appendPicksFromPool(out, used, pools.gameLines, slots.gameLines, target, varietySeed, deadlineAt);
  appendPicksFromPool(out, used, pools.teamTotals, slots.teamTotals, target, varietySeed, deadlineAt);
  appendPicksFromPool(out, used, pools.alternateLines, slots.alternateLines, target, varietySeed, deadlineAt);

  const finalPicks = applyBalancedCapAndBackfill(
    out,
    target,
    pools,
    varietySeed,
    scored,
    ticketStyle,
  ).slice(0, target);
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
  requestId?: string;
  onBuildPhase?: import("./coachScanPipeline.ts").CoachScanPhaseCallback;
  onBuildProgress?: import("./coachBuildProgress.ts").CoachBuildProgressCallback;
  correlationDeadlineAt?: number;
};

/** Step 2: highest-rated mains first. Step 3: qualifying alts to reach target. */
export function buildStagedTicketFromScan(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  varietyContext?: CoachTicketStagingContext & { preview?: boolean },
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const ticketStyle = varietyContext?.ticketStyle ?? "balanced";
  const requestId = varietyContext?.requestId ?? varietySeed ?? "unknown";

  if (varietyContext?.preview) {
    return buildBalancedStagedTicketFromScan(scored, target, varietySeed, ticketStyle);
  }

  const onBuildProgress = varietyContext?.onBuildProgress;
  const deadlineAt = varietyContext?.correlationDeadlineAt ?? correlationDeadline();

  const lineStart = Date.now();
  logCoachScanLineValueStart(requestId);
  const qualifying = qualifyingScoredLegs(scored);
  logCoachScanLineValueComplete(
    requestId,
    scored.length,
    qualifying.length,
    Date.now() - lineStart,
    onBuildProgress,
  );

  const skipCorrelation = shouldSkipCorrelationScoring(qualifying.length, target);
  let result: { picks: ParsedPick[]; breakdown: TicketStagingBreakdown };

  if (target >= 3 && varietySeed && !skipCorrelation) {
    result = buildIndependentCoachTicket(scored, target, {
      varietySeed,
      ticketStyle,
      ...varietyContext,
      correlationDeadlineAt: deadlineAt,
    });
  } else if (target >= 3) {
    result = buildBalancedStagedTicketFromScan(
      scored,
      target,
      varietySeed,
      ticketStyle,
      skipCorrelation ? undefined : deadlineAt,
    );
  } else {
    result = buildStagedTicketFromScanSmallTarget(
      scored,
      target,
      varietySeed,
      skipCorrelation ? undefined : deadlineAt,
    );
  }

  return result;
}

/** Async board-scan staging — correlation only (no preview, no duplicate line-value). */
export async function buildStagedTicketFromScanAsync(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  varietyContext?: CoachTicketStagingContext & { preview?: boolean },
): Promise<{ picks: ParsedPick[]; breakdown: TicketStagingBreakdown }> {
  const ticketStyle = varietyContext?.ticketStyle ?? "balanced";
  const requestId = varietyContext?.requestId ?? varietySeed ?? "unknown";

  if (varietyContext?.preview) {
    return buildBalancedStagedTicketFromScan(scored, target, varietySeed, ticketStyle);
  }

  const correlation = await runCoachCorrelationStage(scored, target, {
    requestId,
    varietySeed,
    ticketStyle,
    varietyContext,
    onBuildProgress: varietyContext?.onBuildProgress,
    onBuildPhase: varietyContext?.onBuildPhase,
  });

  return { picks: correlation.picks, breakdown: correlation.breakdown };
}

function buildStagedTicketFromScanSmallTarget(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  deadlineAt?: number,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const mains: BoardScoredLeg[] = [];
  const alts: BoardScoredLeg[] = [];

  for (const leg of scored) {
    const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
    if (role === "main") mains.push(leg);
    else if (role === "alt") alts.push(leg);
  }

  mains.sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  alts.sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));

  const mainPicks = selectTopBoardLegs(mains, target, varietySeed, deadlineAt).map((p) => ({
    ...p,
    ticketRole: "main" as const,
  }));
  let allPicks = [...mainPicks];
  const used = new Set(allPicks.map(pickLegFingerprint));
  const altPool = alts.filter((l) => !used.has(pickLegFingerprint(l.pick)));

  const gap = Math.max(0, target - allPicks.length);
  if (gap > 0 && altPool.length > 0) {
    const altPicks = (
      target >= 3
        ? selectTopBoardLegs(altPool, gap, varietySeed, deadlineAt)
        : selectGreedyBoardLegs(altPool, gap, varietySeed)
    ).map((p) => ({
      ...p,
      ticketRole: "alt" as const,
      highRiskValuePlay: false,
    }));
    allPicks = [...allPicks, ...altPicks];
  }

  const mainGap = Math.max(0, target - allPicks.length);
  if (mainGap > 0) {
    const usedFp = new Set(allPicks.map(pickLegFingerprint));
    const remainingMains = mains.filter((l) => !usedFp.has(pickLegFingerprint(l.pick)));
    const extraMains = (
      target >= 3
        ? selectTopBoardLegs(remainingMains, mainGap, varietySeed, deadlineAt)
        : selectGreedyBoardLegs(remainingMains, mainGap, varietySeed)
    ).map((p) => ({ ...p, ticketRole: "main" as const, highRiskValuePlay: false }));
    allPicks = [...allPicks, ...extraMains];
  }

  let finalPicks = applyCapAndBackfillToTarget(allPicks.slice(0, target), target, [
    ...mains,
    ...alts,
  ]);
  if (finalPicks.length < target) {
    finalPicks = tieredBackfillStagedTicket(finalPicks, target, scored, "balanced", varietySeed);
  }
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
