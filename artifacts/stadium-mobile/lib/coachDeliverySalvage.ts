// Coach delivery salvage — never return a short ticket when scored candidates exist.

import type { ParsedPick } from "../components/PickCard.tsx";
import { tagCoachDeliveryTier } from "./coachDeliveredPickAnalysis.ts";
import {
  applyCoachTicketFallbackLadder,
  COACH_MEDIUM_MIN_CONFIDENCE,
  COACH_MEDIUM_MIN_GRADE,
  legQualifiesTier2,
  legQualifiesTier3,
  legQualifiesTier4,
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

function stagedFromLeg(leg: BoardScoredLeg, tag?: "medium" | "tier4"): ParsedPick {
  const base = {
    ...leg.pick,
    coachDelivered: true,
    highRiskValuePlay: false,
  };
  if (tag === "medium") {
    return tagCoachDeliveryTier(base, 3);
  }
  if (tag === "tier4") {
    return tagCoachDeliveryTier(base, 4);
  }
  return { ...base, coachDelivered: true };
}

function greedyRelaxedTicket(
  pool: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
  tag?: "medium" | "tier4",
): ParsedPick[] {
  const greedy = selectGreedyBoardLegs(pool, target, varietySeed);
  if (greedy.length >= target) {
    return greedy.map((pick) => stagedFromLeg({ pick } as BoardScoredLeg, tag));
  }
  const used = new Set(greedy.map((p) => pickLegFingerprint(p)));
  const out: ParsedPick[] = greedy.map((pick) => stagedFromLeg({ pick } as BoardScoredLeg, tag));
  const sorted = [...pool].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  for (const leg of sorted) {
    if (out.length >= target) break;
    const fp = pickLegFingerprint(leg.pick);
    if (used.has(fp)) continue;
    out.push(stagedFromLeg(leg, tag));
    used.add(fp);
  }
  return out.slice(0, target);
}

/** Deliver coach-tagged picks — positive edge only; honor tier relaxations. */
function deliverRelaxedPicks(
  picks: ParsedPick[],
  enrich: CoachPickEnrichSources | undefined,
  target: number,
): ParsedPick[] {
  const tagged = picks.map((p) => ({ ...p, coachDelivered: true }));
  const analyzed = ensureCoachDeliveredPickAnalyses(tagged);
  const strict = filterCoachDeliveredPicks(analyzed, enrich);
  if (strict.length >= Math.min(target, analyzed.length)) {
    return strict.slice(0, target);
  }
  const positiveEdge = analyzed.filter((p) => {
    const score = p.finalAiScore;
    if (!score || score.highRiskValuePlay) return false;
    if (!pickHasSimGrade(p, score.simHit)) return false;
    return hasPositiveEdgeEv(p, score);
  });
  return positiveEdge.slice(0, target);
}

export type CoachDeliverySalvageResult = {
  picks: ParsedPick[];
  relaxationsApplied: string[];
  source: "strict" | "confidence" | "correlation" | "alternate" | "medium" | "positive-ev";
};

export type CoachDeliverySalvageOpts = {
  scored: BoardScoredLeg[];
  target: number;
  enrich?: CoachPickEnrichSources;
  varietySeed?: string;
  stagedPicks?: ParsedPick[];
};

/**
 * Build a deliverable ticket using progressive relaxation:
 * 1. Strict → 2. Confidence → 3. Correlation → 4. Alternate lines →
 * 5. Medium confidence → 6. Best positive-EV markets (Tier 4)
 */
export function salvageCoachDelivery(opts: CoachDeliverySalvageOpts): CoachDeliverySalvageResult {
  const { scored, target, enrich, varietySeed, stagedPicks = [] } = opts;
  const relaxations: string[] = [];
  const positive = positiveEdgeScoredLegs(scored);

  if (!positive.length && !stagedPicks.length) {
    return { picks: [], relaxationsApplied: relaxations, source: "strict" };
  }

  let best: ParsedPick[] = [];

  if (stagedPicks.length) {
    const delivered = deliverRelaxedPicks(stagedPicks, enrich, target);
    if (delivered.length > best.length) {
      best = delivered;
    }
    if (best.length >= target) {
      return { picks: best, relaxationsApplied: relaxations, source: "strict" };
    }
  }

  const ladder = applyCoachTicketFallbackLadder(
    scored,
    best,
    target,
    varietySeed,
    "balanced",
  );
  const ladderDelivered = deliverRelaxedPicks(ladder.picks, enrich, target);
  if (ladderDelivered.length > best.length) {
    best = ladderDelivered;
    if (ladder.tierCounts[2] > 0) relaxations.push("alternate lines");
    if (ladder.tierCounts[3] > 0) relaxations.push("medium-confidence");
    if (ladder.tierCounts[4] > 0) relaxations.push("positive-ev");
  }
  if (best.length >= target) {
    return { picks: best, relaxationsApplied: relaxations, source: "alternate" };
  }

  // 1. Confidence relaxation
  const confPool = confidenceRelaxedScoredLegs(scored);
  if (confPool.length) {
    relaxations.push("confidence");
    let picks = greedyRelaxedTicket(confPool, target, varietySeed);
    let delivered = deliverRelaxedPicks(picks, enrich, target);
    if (delivered.length > best.length) best = delivered;
    if (best.length >= target) {
      return { picks: best, relaxationsApplied: relaxations, source: "confidence" };
    }

    // 2. Correlation relaxation — greedy without correlation penalty skips
    relaxations.push("correlation");
    picks = greedyRelaxedTicket(confPool, target, `${varietySeed ?? "salvage"}-nocorr`);
    delivered = deliverRelaxedPicks(picks, enrich, target);
    if (delivered.length > best.length) best = delivered;
    if (best.length >= target) {
      return { picks: best, relaxationsApplied: relaxations, source: "correlation" };
    }

    // 3. Alternate + medium ladder (again from expanded seed)
    const altFallback = applyCoachTicketFallbackLadder(
      scored,
      best,
      target,
      varietySeed,
      "balanced",
    );
    delivered = deliverRelaxedPicks(altFallback.picks, enrich, target);
    if (delivered.length > best.length) {
      best = delivered;
      relaxations.push("alternate lines");
    }
    if (best.length >= target) {
      return { picks: best, relaxationsApplied: relaxations, source: "alternate" };
    }

    // 4. Medium-confidence picks
    relaxations.push("medium-confidence");
    const mediumPool = positive.filter((leg) => legQualifiesTier3(leg.pick, leg.pick.finalAiScore));
    const mediumPicks = greedyRelaxedTicket(
      mediumPool.length ? mediumPool : confPool,
      target,
      varietySeed,
      "medium",
    );
    const tier3Fallback = applyCoachTicketFallbackLadder(
      scored,
      mediumPicks,
      target,
      varietySeed,
      "balanced",
    );
    delivered = deliverRelaxedPicks(tier3Fallback.picks, enrich, target);
    if (delivered.length > best.length) best = delivered;
    if (best.length >= target) {
      return { picks: best, relaxationsApplied: relaxations, source: "medium" };
    }

    // 5. Tier 4 — best remaining positive-EV markets
    relaxations.push("positive-ev");
    const tier4Pool = positive.filter((leg) => legQualifiesTier4(leg.pick, leg.pick.finalAiScore));
    const tier4Picks = greedyRelaxedTicket(
      tier4Pool.length ? tier4Pool : positive,
      target,
      varietySeed,
      "tier4",
    );
    const tier4Fallback = applyCoachTicketFallbackLadder(
      scored,
      tier4Picks,
      target,
      varietySeed,
      "balanced",
    );
    delivered = deliverRelaxedPicks(tier4Fallback.picks, enrich, target);
    if (delivered.length > best.length) best = delivered;

    if (best.length > 0) {
      return {
        picks: best,
        relaxationsApplied: relaxations,
        source: "positive-ev",
      };
    }

    // Last resort — any positive-edge sim-graded legs, sorted strongest first
    const lastResort = greedyRelaxedTicket(positive, target, varietySeed, "tier4");
    delivered = deliverRelaxedPicks(lastResort, enrich, target);
    return {
      picks: delivered.length > best.length ? delivered : best,
      relaxationsApplied: [...relaxations, "last-resort-positive-edge"],
      source: "positive-ev",
    };
  }

  // No confidence-relaxed pool — still try ladder + medium + tier4 from positive edge pool
  relaxations.push("alternate lines");
  const altOnly = applyCoachTicketFallbackLadder(scored, best, target, varietySeed, "balanced");
  let delivered = deliverRelaxedPicks(altOnly.picks, enrich, target);
  if (delivered.length > best.length) best = delivered;
  if (best.length >= target) {
    return { picks: best, relaxationsApplied: relaxations, source: "alternate" };
  }

  relaxations.push("medium-confidence");
  const mediumOnly = positive
    .filter((leg) => legQualifiesTier2(leg.pick, leg.pick.finalAiScore) || legQualifiesTier3(leg.pick, leg.pick.finalAiScore))
    .map((leg) => tagCoachDeliveryTier(stagedFromLeg(leg, "medium"), 3));
  delivered = deliverRelaxedPicks(mediumOnly.slice(0, target), enrich, target);
  if (delivered.length > best.length) best = delivered;
  if (best.length >= target) {
    return { picks: best, relaxationsApplied: relaxations, source: "medium" };
  }

  relaxations.push("positive-ev");
  const lastResort = greedyRelaxedTicket(positive, target, varietySeed, "tier4");
  delivered = deliverRelaxedPicks(lastResort, enrich, target);
  return {
    picks: delivered.length > best.length ? delivered : best,
    relaxationsApplied: [...relaxations, "last-resort-positive-edge"],
    source: "positive-ev",
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
