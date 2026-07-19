// Coach delivery salvage — fill to target from scored pool; never stop after first tier.

import type { ParsedPick } from "../components/PickCard.tsx";
import { tagCoachDeliveryTier } from "./coachDeliveredPickAnalysis.ts";
import {
  applyCoachTicketFallbackLadder,
  COACH_MEDIUM_MIN_CONFIDENCE,
  COACH_MEDIUM_MIN_GRADE,
  type CoachTicketFallbackResult,
} from "./coachTicketFallbackLadder.ts";
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import {
  ensureCoachDeliveredPickAnalyses,
} from "./coachDeliveredPickAnalysis.ts";
import {
  filterCoachDeliveredPicks,
  type CoachPickEnrichSources,
} from "./pickRecommendation.ts";
import { selectGreedyBoardLegs, type BoardScoredLeg } from "./ticketStaging.ts";

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

function hasPositiveEdgeEv(pick: ParsedPick, score: NonNullable<ParsedPick["finalAiScore"]>): boolean {
  if ((score.edgePct ?? 0) <= 0) return false;
  if (pick.odds == null || !Number.isFinite(pick.odds)) return false;
  if (score.simHit == null) return false;
  const ev = simEvPct(score.simHit, pick.odds);
  if (ev != null && ev <= 0) return false;
  if (score.simHit <= impliedProb(pick.odds)) return false;
  return true;
}

/** Scored legs with sim grade and positive edge/EV — minimum deliverable bar. */
export function positiveEdgeScoredLegs(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  return scored.filter((leg) => {
    const score = leg.pick.finalAiScore;
    if (!score || score.highRiskValuePlay) return false;
    if (!pickHasSimGrade(leg.pick, score.simHit)) return false;
    return hasPositiveEdgeEv(leg.pick, score);
  });
}

/** Step 1 — relax confidence floor to medium-confidence minimum. */
export function confidenceRelaxedScoredLegs(scored: BoardScoredLeg[]): BoardScoredLeg[] {
  return positiveEdgeScoredLegs(scored).filter((leg) => {
    const score = leg.pick.finalAiScore!;
    if (gradeRank(score.grade) < gradeRank(COACH_MEDIUM_MIN_GRADE)) return false;
    return (score.confidencePct ?? 0) >= COACH_MEDIUM_MIN_CONFIDENCE;
  });
}

function stagedFromLeg(leg: BoardScoredLeg, tier?: 2 | 3 | 4): ParsedPick {
  const base = {
    ...leg.pick,
    coachDelivered: true,
    highRiskValuePlay: false,
  };
  if (tier) return tagCoachDeliveryTier(base, tier);
  return tagCoachDeliveryTier(base, 1);
}

function mergeUniquePicks(
  current: ParsedPick[],
  additions: ParsedPick[],
  target: number,
): ParsedPick[] {
  const used = new Set(current.map((p) => pickLegFingerprint(p)));
  const out = [...current];
  for (const pick of additions) {
    if (out.length >= target) break;
    const fp = pickLegFingerprint(pick);
    if (used.has(fp)) continue;
    out.push(pick);
    used.add(fp);
  }
  return out.slice(0, target);
}

function greedyPositiveEdgeTicket(
  pool: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  tier: 2 | 3 | 4 = 4,
): ParsedPick[] {
  const greedy = selectGreedyBoardLegs(pool, target, varietySeed);
  const staged = greedy.map((pick) => stagedFromLeg({ pick } as BoardScoredLeg, tier));
  if (staged.length >= target) return staged;
  const used = new Set(staged.map((p) => pickLegFingerprint(p)));
  const out = [...staged];
  const sorted = [...pool].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  for (const leg of sorted) {
    if (out.length >= target) break;
    const fp = pickLegFingerprint(leg.pick);
    if (used.has(fp)) continue;
    out.push(stagedFromLeg(leg, tier));
    used.add(fp);
  }
  return out.slice(0, target);
}

/** Walk Tier 1 → 4 on the full scored pool until target or pool exhausted. */
export function buildTieredCoachTicketFromPool(
  scored: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  seedPicks: ParsedPick[] = [],
): CoachTicketFallbackResult {
  const ladder = applyCoachTicketFallbackLadder(scored, seedPicks, target, varietySeed, "balanced");
  if (ladder.picks.length >= target) return ladder;

  const positive = positiveEdgeScoredLegs(scored);
  const greedy = greedyPositiveEdgeTicket(positive, target, varietySeed, 4);
  return {
    ...ladder,
    picks: mergeUniquePicks(ladder.picks, greedy, target),
    tierCounts: {
      ...ladder.tierCounts,
      4: ladder.tierCounts[4] + Math.max(0, mergeUniquePicks(ladder.picks, greedy, target).length - ladder.picks.length),
    },
    shortfallReasons: ladder.shortfallReasons,
  };
}

/** Deliver coach-tagged picks — backfill from scored pool when input is short. */
function deliverRelaxedPicks(
  picks: ParsedPick[],
  scored: BoardScoredLeg[],
  enrich: CoachPickEnrichSources | undefined,
  target: number,
  varietySeed?: string,
): ParsedPick[] {
  let candidate = picks.map((p) => ({ ...p, coachDelivered: true }));

  if (candidate.length < target && scored.length) {
    const tiered = buildTieredCoachTicketFromPool(scored, target, varietySeed, candidate);
    if (tiered.picks.length > candidate.length) {
      candidate = tiered.picks;
    }
  }

  if (candidate.length < target) {
    const positive = positiveEdgeScoredLegs(scored);
    const greedy = greedyPositiveEdgeTicket(positive, target, varietySeed, 4);
    candidate = mergeUniquePicks(candidate, greedy, target);
  }

  const analyzed = ensureCoachDeliveredPickAnalyses(candidate);
  const strict = filterCoachDeliveredPicks(analyzed, enrich);
  if (strict.length >= target) return strict.slice(0, target);

  const positiveEdge = analyzed.filter((p) => {
    const score = p.finalAiScore;
    if (!score || score.highRiskValuePlay) return false;
    if (!pickHasSimGrade(p, score.simHit)) return false;
    return hasPositiveEdgeEv(p, score);
  });
  if (positiveEdge.length >= target) return positiveEdge.slice(0, target);

  if (strict.length > 0) return strict;
  return positiveEdge;
}

export type CoachDeliverySalvageResult = {
  picks: ParsedPick[];
  relaxationsApplied: string[];
  source: "strict" | "confidence" | "correlation" | "alternate" | "medium" | "positive-ev";
  tierResult?: CoachTicketFallbackResult;
  positiveEdgePool: number;
};

export type CoachDeliverySalvageOpts = {
  scored: BoardScoredLeg[];
  target: number;
  enrich?: CoachPickEnrichSources;
  varietySeed?: string;
  stagedPicks?: ParsedPick[];
};

/**
 * Build a deliverable ticket using progressive tier fill on the full scored pool.
 * Tier 1 (strict) → Tier 2 (lower confidence +EV) → Tier 3 (alts) → Tier 4 (remaining +EV).
 */
export function salvageCoachDelivery(opts: CoachDeliverySalvageOpts): CoachDeliverySalvageResult {
  const { scored, target, enrich, varietySeed, stagedPicks = [] } = opts;
  const relaxations: string[] = [];
  const positive = positiveEdgeScoredLegs(scored);

  if (!positive.length && !stagedPicks.length) {
    return {
      picks: [],
      relaxationsApplied: relaxations,
      source: "strict",
      positiveEdgePool: 0,
    };
  }

  const tierResult = buildTieredCoachTicketFromPool(scored, target, varietySeed, stagedPicks);
  if (tierResult.tierCounts[1] > 0) relaxations.push("tier-1-strict");
  if (tierResult.tierCounts[2] > 0) relaxations.push("tier-2-medium-confidence");
  if (tierResult.tierCounts[3] > 0) relaxations.push("tier-3-alternate-lines");
  if (tierResult.tierCounts[4] > 0) relaxations.push("tier-4-positive-ev");

  let picks = deliverRelaxedPicks(tierResult.picks, scored, enrich, target, varietySeed);

  if (picks.length < target && positive.length > picks.length) {
    relaxations.push("greedy-positive-edge-backfill");
    const greedy = greedyPositiveEdgeTicket(positive, target, varietySeed, 4);
    picks = deliverRelaxedPicks(mergeUniquePicks(picks, greedy, target), scored, enrich, target, varietySeed);
  }

  return {
    picks,
    relaxationsApplied: relaxations,
    source: picks.length >= target ? "strict" : "positive-ev",
    tierResult,
    positiveEdgePool: positive.length,
  };
}

/** True when salvage should run instead of returning a short ticket. */
export function shouldSalvageCoachDelivery(
  deliveredCount: number,
  target: number,
  scoredPool: BoardScoredLeg[] | null | undefined,
): boolean {
  if (target <= 0) return false;
  if (deliveredCount >= target) return false;
  if (!scoredPool?.length) return false;
  return positiveEdgeScoredLegs(scoredPool).length > deliveredCount;
}
