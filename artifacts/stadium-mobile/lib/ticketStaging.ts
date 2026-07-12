// Step 2: fill with highest-rated mains. Step 3: qualifying alts to reach N.

import type { ParsedPick } from "../components/PickCard.tsx";
import { isAltBoardPick, isAltPropPick, isMainBoardPick, ticketRoleForPick } from "./altLinePool.ts";
import type { TicketStagingBreakdown } from "./fullBoardMarketCopy.ts";
import { gameLineLegBucket, isGameLinePick } from "./gameSimScoring.ts";
import { selectCorrelationAwareBoardLegs, maxLegsPerThinStatMarket, isThinPropStatMarket } from "./parlayCorrelationScore.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { pickIsAiRecommended, qualifiesAltPick } from "./pickRecommendation.ts";
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
    return pickIsAiRecommended(pick, score ?? undefined) ? "main" : null;
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
  return null;
}

/** Label each leg main vs alt for ticket gating and ALT PICK badges. */
export function tagTicketRoles(picks: ParsedPick[]): ParsedPick[] {
  return picks.map((p) => ({ ...p, ticketRole: ticketRoleForPick(p) }));
}

/** Greedy top-N by rank — no correlation penalty (used to fill alt gaps to reach N). */
export function selectGreedyBoardLegs(ranked: BoardScoredLeg[], target: number): ParsedPick[] {
  const seen = new Set<string>();
  const out: ParsedPick[] = [];
  for (const row of ranked) {
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
export function selectTopBoardLegs(ranked: BoardScoredLeg[], target: number): ParsedPick[] {
  if (target < 3) return selectGreedyBoardLegs(ranked, target);

  const out: ParsedPick[] = [];
  const usedFp = new Set<string>();
  const sorted = [...ranked].sort((a, b) => b.rankScore - a.rankScore);

  while (out.length < target) {
    const remaining = sorted.filter((r) => !usedFp.has(pickLegFingerprint(r.pick)));
    if (!remaining.length) break;

    const next = selectCorrelationAwareBoardLegs(remaining, 1);
    if (!next.length) break;

    const pick = next[0]!;
    usedFp.add(pickLegFingerprint(pick));
    const deduped = dedupeSameTeamGameLegsLite([...out, pick]);
    if (deduped.length <= out.length) continue;
    out.length = 0;
    out.push(...deduped);
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
  return current;
}

/** Step 2: highest-rated mains first. Step 3: qualifying alts to reach target. */
export function buildStagedTicketFromScan(
  scored: BoardScoredLeg[],
  target: number,
): { picks: ParsedPick[]; breakdown: TicketStagingBreakdown } {
  const mains: BoardScoredLeg[] = [];
  const alts: BoardScoredLeg[] = [];

  for (const leg of scored) {
    const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
    if (role === "main") mains.push(leg);
    else if (role === "alt") alts.push(leg);
  }

  mains.sort((a, b) => b.rankScore - a.rankScore);
  alts.sort((a, b) => b.rankScore - a.rankScore);

  const mainPicks = selectTopBoardLegs(mains, target).map((p) => ({
    ...p,
    ticketRole: "main" as const,
  }));
  let allPicks = [...mainPicks];
  const used = new Set(allPicks.map(pickLegFingerprint));
  const altPool = alts.filter((l) => !used.has(pickLegFingerprint(l.pick)));

  // Alt gap fill: greedy rank order — promoted alternates get ALT PICK badges.
  const gap = Math.max(0, target - allPicks.length);
  if (gap > 0 && altPool.length > 0) {
    const altPicks = (target >= 3 ? selectTopBoardLegs(altPool, gap) : selectGreedyBoardLegs(altPool, gap)).map(
      (p) => ({
      ...p,
      ticketRole: "alt" as const,
      highRiskValuePlay: false,
    }),
    );
    allPicks = [...allPicks, ...altPicks];
  }

  // Last resort: any remaining qualifying mains if alts exhausted but mains remain.
  const mainGap = Math.max(0, target - allPicks.length);
  if (mainGap > 0) {
    const usedFp = new Set(allPicks.map(pickLegFingerprint));
    const remainingMains = mains.filter((l) => !usedFp.has(pickLegFingerprint(l.pick)));
    const extraMains = (target >= 3 ? selectTopBoardLegs(remainingMains, mainGap) : selectGreedyBoardLegs(remainingMains, mainGap)).map(
      (p) => ({ ...p, ticketRole: "main" as const, highRiskValuePlay: false }),
    );
    allPicks = [...allPicks, ...extraMains];
  }

  const finalPicks = applyCapAndBackfillToTarget(allPicks.slice(0, target), target, [...mains, ...alts]);
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
