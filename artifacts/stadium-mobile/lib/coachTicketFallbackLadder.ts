// Tiered fallback ladder for fixed-leg Coach tickets — Tier 1 strict, Tier 2 alts, Tier 3 medium.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { FinalAiScore } from "./finalAiScore.ts";
import { isAltBoardPick, isAltPropPick } from "./altLinePool.ts";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { parlayCorrelationPenalty } from "./parlayCorrelationScore.ts";
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { pickQualifiesForBoardDelivery, propSimEdgeStagingQualifies } from "./pickRecommendation.ts";
import { tagCoachDeliveryTier } from "./coachDeliveredPickAnalysis.ts";
import { compareBoardLegsForRank } from "./coachBoardRankVariety.ts";
import type { CoachTicketStyle } from "./coachTicketQualityTiers.ts";
import { boardLegPoolRole, type BoardScoredLeg } from "./ticketStaging.ts";

export const COACH_MEDIUM_MIN_CONFIDENCE = 45;
export const COACH_MEDIUM_MIN_GRADE = "C";

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

/** Posted alternate markets eligible for Tier 2 backfill. */
export const TIER2_ALT_MARKET_PATTERNS: readonly RegExp[] = [
  /\bpoints?\b/i,
  /\brebounds?\b/i,
  /\bassists?\b/i,
  /\bpra\b|pts.*reb|reb.*ast|points.*rebounds.*assists/i,
  /\bpassing\s+yards?\b/i,
  /\brush(ing)?\s+yards?\b/i,
  /\breceiv(ing)?\s+yards?\b/i,
  /\bstrikeouts?\b/i,
  /\bhits?\b/i,
  /\bbases?\b/i,
  /\btotal\s+bases?\b/i,
  /\bspread\b/i,
  /\bteam\s+total\b/i,
  /\btotal\b/i,
];

export function isTier2SupportedAltMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "").trim();
  if (!m) return false;
  return TIER2_ALT_MARKET_PATTERNS.some((re) => re.test(m));
}

export type CoachFallbackTier = 1 | 2 | 3 | 4;

export type CoachTicketFallbackResult = {
  picks: ParsedPick[];
  tierCounts: Record<CoachFallbackTier, number>;
  shortfallReasons: string[];
  coverageBySport: Record<string, number>;
  coverageByMarket: Record<string, number>;
};

function hasVerifiedOdds(pick: ParsedPick): boolean {
  return pick.odds != null && Number.isFinite(pick.odds) && pick.odds !== 0;
}

function hasPostedLine(pick: ParsedPick): boolean {
  if (!pick.isProp) return true;
  return pick.propLine != null && !!pick.propSide;
}

function positiveEdgeEv(pick: ParsedPick, score: FinalAiScore): boolean {
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return true;
}

/** Tier 1 — strict board staging gates. */
export function legQualifiesTier1(pick: ParsedPick, score: FinalAiScore | null | undefined): boolean {
  return boardLegPoolRole(pick, score) != null;
}

/** Tier 2 — slightly lower confidence posted lines with positive EV (not Tier 1). */
export function legQualifiesTier2(pick: ParsedPick, score: FinalAiScore | null | undefined): boolean {
  if (!score || score.highRiskValuePlay) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (!hasVerifiedOdds(pick) || !hasPostedLine(pick)) return false;
  if (!positiveEdgeEv(pick, score)) return false;
  if (legQualifiesTier1(pick, score)) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_MEDIUM_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < COACH_MEDIUM_MIN_CONFIDENCE) return false;
  if (score.simHit != null && pick.odds != null && score.simHit <= impliedProb(pick.odds)) return false;
  const isAlt = isAltBoardPick(pick) || isAltPropPick(pick) || !!pick.propIsAlt;
  if (isAlt) return false;
  return true;
}

/** Tier 3 — posted alternate lines on supported markets with positive edge. */
export function legQualifiesTier3(pick: ParsedPick, score: FinalAiScore | null | undefined): boolean {
  if (!score || score.highRiskValuePlay) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (!hasVerifiedOdds(pick) || !hasPostedLine(pick)) return false;
  if (!positiveEdgeEv(pick, score)) return false;
  if (legQualifiesTier1(pick, score) || legQualifiesTier2(pick, score)) return false;
  const isAlt = isAltBoardPick(pick) || isAltPropPick(pick) || !!pick.propIsAlt;
  if (!isAlt) return false;
  return isTier2SupportedAltMarket(pick.market);
}

/** Tier 4 — best remaining positive-edge posted markets (relaxed grade/confidence). */
export function legQualifiesTier4(pick: ParsedPick, score: FinalAiScore | null | undefined): boolean {
  if (!score || score.highRiskValuePlay) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (!hasVerifiedOdds(pick) || !hasPostedLine(pick)) return false;
  if (!positiveEdgeEv(pick, score)) return false;
  if (legQualifiesTier1(pick, score) || legQualifiesTier2(pick, score) || legQualifiesTier3(pick, score)) {
    return false;
  }
  if (score.simHit != null && pick.odds != null && score.simHit <= impliedProb(pick.odds)) return false;
  return true;
}

function stagedLegDeliverable(pick: ParsedPick, tier: CoachFallbackTier): boolean {
  const score = pick.finalAiScore;
  if (!score || score.highRiskValuePlay) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  if (pick.coachDelivered || pick.coachDeliveryTier != null) return true;
  if (tier === 4) return true;
  if (tier === 3) {
    return pick.ticketRole === "alt" || !!pick.coachAlternateLineLabel || pick.coachDeliveryTier === 3;
  }
  if (tier === 2) {
    return pick.coachConfidenceLabel === "Medium confidence" || pick.coachDeliveryTier === 2;
  }
  return pickQualifiesForBoardDelivery(pick, score) || propSimEdgeStagingQualifies(pick, score);
}

function stagedPickFromLeg(
  leg: BoardScoredLeg,
  tier: CoachFallbackTier,
): ParsedPick {
  const role = boardLegPoolRole(leg.pick, leg.pick.finalAiScore);
  const base: ParsedPick = {
    ...leg.pick,
    ticketRole: role ?? (isAltBoardPick(leg.pick) || isAltPropPick(leg.pick) ? "alt" : "main"),
    highRiskValuePlay: false,
  };
  return tagCoachDeliveryTier(base, tier);
}

function coverageMaps(picks: ParsedPick[]): {
  coverageBySport: Record<string, number>;
  coverageByMarket: Record<string, number>;
} {
  const coverageBySport: Record<string, number> = {};
  const coverageByMarket: Record<string, number> = {};
  for (const p of picks) {
    const sport = String(p.sport ?? "unknown").toLowerCase();
    coverageBySport[sport] = (coverageBySport[sport] ?? 0) + 1;
    const market = String(p.market ?? "unknown");
    coverageByMarket[market] = (coverageByMarket[market] ?? 0) + 1;
  }
  return { coverageBySport, coverageByMarket };
}

function buildShortfallReasons(
  target: number,
  picks: ParsedPick[],
  scored: BoardScoredLeg[],
  tierCounts: Record<CoachFallbackTier, number>,
): string[] {
  if (picks.length >= target) return [];
  const reasons: string[] = [];
  const gap = target - picks.length;
  const tier1Pool = scored.filter((l) => legQualifiesTier1(l.pick, l.pick.finalAiScore)).length;
  const tier2Pool = scored.filter((l) => legQualifiesTier2(l.pick, l.pick.finalAiScore)).length;
  const tier3Pool = scored.filter((l) => legQualifiesTier3(l.pick, l.pick.finalAiScore)).length;
  const tier4Pool = scored.filter((l) => legQualifiesTier4(l.pick, l.pick.finalAiScore)).length;

  if (tier1Pool < target) {
    reasons.push(
      `Only **${tier1Pool}** main-line picks cleared full AI gates (needed **${target}**).`,
    );
  }
  if (tier2Pool > 0 && tierCounts[2] < gap) {
    reasons.push(
      `**${tier2Pool}** medium-confidence positive-EV lines available — **${tierCounts[2]}** used.`,
    );
  }
  if (tier3Pool > 0 && tierCounts[3] < gap - tierCounts[2]) {
    reasons.push(
      `Alternate-line search found **${tier3Pool}** qualifying alt rungs — **${tierCounts[3]}** used.`,
    );
  }
  if (tier4Pool > 0 && tierCounts[4] < gap - tierCounts[2] - tierCounts[3]) {
    reasons.push(
      `**${tier4Pool}** positive-EV posted lines available — **${tierCounts[4]}** used.`,
    );
  }
  if (!tier1Pool && !tier2Pool && !tier3Pool && !tier4Pool) {
    reasons.push("No posted markets on this slate produced a gradable sim with positive edge.");
  }
  return reasons;
}

/** Walk Tier 1 → 2 → 3 until target legs or pool exhausted. Never invent lines/odds. */
export function applyCoachTicketFallbackLadder(
  scored: BoardScoredLeg[],
  current: ParsedPick[],
  target: number,
  varietySeed?: string,
  ticketStyle: CoachTicketStyle = "balanced",
): CoachTicketFallbackResult {
  const used = new Set(current.map(pickLegFingerprint));
  const picks: ParsedPick[] = [...current];
  const tierCounts: Record<CoachFallbackTier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  const tiers: Array<{ tier: CoachFallbackTier; qualify: typeof legQualifiesTier1 }> = [
    { tier: 1, qualify: legQualifiesTier1 },
  ];
  if (ticketStyle !== "safe") {
    tiers.push({ tier: 2, qualify: legQualifiesTier2 });
    tiers.push({ tier: 3, qualify: legQualifiesTier3 });
    tiers.push({ tier: 4, qualify: legQualifiesTier4 });
  }

  for (const { tier, qualify } of tiers) {
    if (picks.length >= target) break;
    const pool = [...scored]
      .filter((leg) => {
        const fp = pickLegFingerprint(leg.pick);
        if (used.has(fp)) return false;
        return qualify(leg.pick, leg.pick.finalAiScore);
      })
      .sort((a, b) => compareBoardLegsForRank(a, b, varietySeed));

    for (const leg of pool) {
      if (picks.length >= target) break;
      const fp = pickLegFingerprint(leg.pick);
      if (used.has(fp)) continue;
      const corr = parlayCorrelationPenalty(leg.pick, picks);
      if (picks.length >= target) break;
      if (corr > 85 && picks.length >= target - 2 && picks.length >= Math.ceil(target * 0.85)) {
        continue;
      }
      const staged = stagedPickFromLeg(leg, tier);
      if (!stagedLegDeliverable(staged, tier)) continue;
      picks.push(staged);
      used.add(fp);
      tierCounts[tier] += 1;
    }
  }

  const finalPicks = picks.slice(0, target);
  const { coverageBySport, coverageByMarket } = coverageMaps(finalPicks);
  return {
    picks: finalPicks,
    tierCounts,
    shortfallReasons: buildShortfallReasons(target, finalPicks, scored, tierCounts),
    coverageBySport,
    coverageByMarket,
  };
}
