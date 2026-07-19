// Coach delivery salvage — never return zero picks when scored candidates exist.

import type { ParsedPick } from "../components/PickCard.tsx";
import { tagCoachDeliveryTier } from "./coachDeliveredPickAnalysis.ts";
import {
  applyCoachTicketFallbackLadder,
  COACH_MEDIUM_MIN_CONFIDENCE,
  COACH_MEDIUM_MIN_GRADE,
  legQualifiesTier2,
  legQualifiesTier3,
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

function stagedFromLeg(leg: BoardScoredLeg, tag?: "medium"): ParsedPick {
  const base = {
    ...leg.pick,
    coachDelivered: true,
    highRiskValuePlay: false,
  };
  if (tag === "medium") {
    return tagCoachDeliveryTier(base, 3);
  }
  return { ...base, coachDelivered: true };
}

function greedyRelaxedTicket(
  pool: BoardScoredLeg[],
  target: number,
  varietySeed?: string,
): ParsedPick[] {
  const greedy = selectGreedyBoardLegs(pool, target, varietySeed);
  if (greedy.length >= target) {
    return greedy.map((pick) => stagedFromLeg({ pick } as BoardScoredLeg));
  }
  const used = new Set(greedy.map((p) => pickLegFingerprint(p)));
  const out: ParsedPick[] = greedy.map((pick) => stagedFromLeg({ pick } as BoardScoredLeg));
  const sorted = [...pool].sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));
  for (const leg of sorted) {
    if (out.length >= target) break;
    const fp = pickLegFingerprint(leg.pick);
    if (used.has(fp)) continue;
    out.push(stagedFromLeg(leg));
    used.add(fp);
  }
  return out.slice(0, target);
}

export type CoachDeliverySalvageResult = {
  picks: ParsedPick[];
  relaxationsApplied: string[];
  source: "strict" | "confidence" | "correlation" | "alternate" | "medium";
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
 * 1. Confidence → 2. Correlation → 3. Alternate lines → 4. Medium confidence
 */
export function salvageCoachDelivery(opts: CoachDeliverySalvageOpts): CoachDeliverySalvageResult {
  const { scored, target, enrich, varietySeed, stagedPicks = [] } = opts;
  const relaxations: string[] = [];
  const positive = positiveEdgeScoredLegs(scored);

  if (!positive.length) {
    return { picks: [], relaxationsApplied: relaxations, source: "strict" };
  }

  const tryDeliver = (picks: ParsedPick[]): ParsedPick[] => {
    const tagged = picks.map((p) => ({ ...p, coachDelivered: true }));
    const analyzed = ensureCoachDeliveredPickAnalyses(tagged);
    return filterCoachDeliveredPicks(analyzed, enrich).slice(0, target);
  };

  if (stagedPicks.length) {
    const delivered = tryDeliver(stagedPicks);
    if (delivered.length >= target || (delivered.length > 0 && delivered.length >= stagedPicks.length)) {
      return { picks: delivered, relaxationsApplied: relaxations, source: "strict" };
    }
  }

  // 1. Confidence relaxation
  const confPool = confidenceRelaxedScoredLegs(scored);
  if (confPool.length) {
    relaxations.push("confidence");
    let picks = greedyRelaxedTicket(confPool, target, varietySeed);
    let delivered = tryDeliver(picks);
    if (delivered.length >= target) {
      return { picks: delivered, relaxationsApplied: relaxations, source: "confidence" };
    }

    // 2. Correlation relaxation — greedy without correlation penalty skips
    relaxations.push("correlation");
    picks = greedyRelaxedTicket(confPool, target, `${varietySeed ?? "salvage"}-nocorr`);
    delivered = tryDeliver(picks);
    if (delivered.length >= target) {
      return { picks: delivered, relaxationsApplied: relaxations, source: "correlation" };
    }

    // 3. Alternate lines
    relaxations.push("alternate lines");
    const altFallback = applyCoachTicketFallbackLadder(
      scored,
      delivered.length ? delivered : picks,
      target,
      varietySeed,
      "balanced",
    );
    delivered = tryDeliver(altFallback.picks);
    if (delivered.length >= target) {
      return { picks: delivered, relaxationsApplied: relaxations, source: "alternate" };
    }

    // 4. Medium-confidence picks
    relaxations.push("medium-confidence");
    const mediumPool = positive.filter((leg) => legQualifiesTier3(leg.pick, leg.pick.finalAiScore));
    const mediumPicks = greedyRelaxedTicket(mediumPool.length ? mediumPool : confPool, target, varietySeed)
      .map((p) => tagCoachDeliveryTier(p, 3));
    const tier3Fallback = applyCoachTicketFallbackLadder(
      scored,
      mediumPicks,
      target,
      varietySeed,
      "balanced",
    );
    delivered = tryDeliver(tier3Fallback.picks);
    if (delivered.length > 0) {
      return { picks: delivered, relaxationsApplied: relaxations, source: "medium" };
    }

    // Last resort — any positive-edge sim-graded legs
    const lastResort = greedyRelaxedTicket(positive, target, varietySeed).map((p) =>
      tagCoachDeliveryTier(p, 3),
    );
    delivered = tryDeliver(lastResort);
    return {
      picks: delivered,
      relaxationsApplied: [...relaxations, "last-resort-positive-edge"],
      source: "medium",
    };
  }

  // No confidence-relaxed pool — still try alt + medium from positive edge pool
  relaxations.push("alternate lines");
  const altOnly = applyCoachTicketFallbackLadder(scored, [], target, varietySeed, "balanced");
  let delivered = tryDeliver(altOnly.picks);
  if (delivered.length > 0) {
    return { picks: delivered, relaxationsApplied: relaxations, source: "alternate" };
  }

  relaxations.push("medium-confidence");
  const mediumOnly = positive
    .filter((leg) => legQualifiesTier2(leg.pick, leg.pick.finalAiScore) || legQualifiesTier3(leg.pick, leg.pick.finalAiScore))
    .map((leg) => tagCoachDeliveryTier(stagedFromLeg(leg, "medium"), 3));
  delivered = tryDeliver(mediumOnly.slice(0, target));
  if (delivered.length > 0) {
    return { picks: delivered, relaxationsApplied: relaxations, source: "medium" };
  }

  const lastResort = greedyRelaxedTicket(positive, target, varietySeed).map((p) =>
    tagCoachDeliveryTier(p, 3),
  );
  delivered = tryDeliver(lastResort);
  return {
    picks: delivered,
    relaxationsApplied: [...relaxations, "last-resort-positive-edge"],
    source: "medium",
  };
}

/** True when salvage should run instead of returning an empty ticket. */
export function shouldSalvageCoachDelivery(
  deliveredCount: number,
  target: number,
  scoredPool: BoardScoredLeg[] | null | undefined,
): boolean {
  if (deliveredCount >= target) return false;
  if (!scoredPool?.length) return false;
  return positiveEdgeScoredLegs(scoredPool).length > 0;
}
