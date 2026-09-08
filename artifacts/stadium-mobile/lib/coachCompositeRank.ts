// Board-scan leg ranking — weighted composite the user configured for ticket assembly.
// Each factor is scored 0–10; weights renormalize over present signals only, and the
// final rank penalizes missing context (partial weight sum).

import type { ParsedPick } from "./parsedPick.ts";
import type { PropHolisticScore } from "./propHolisticRecommendation.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

/** Ticket ranking weights — must sum to 1. */
export const COACH_COMPOSITE_RANK_WEIGHTS = {
  ev: 0.35,
  simulation: 0.25,
  matchup: 0.15,
  recentForm: 0.1,
  injury: 0.05,
  lineMovement: 0.05,
  marketEfficiency: 0.05,
} as const;

export type CoachRankFactorKey = keyof typeof COACH_COMPOSITE_RANK_WEIGHTS;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** EV% → 0–10: +20% EV scores 10; 0% EV scores 0. */
export function evPctToRankScore(evPct: number | null | undefined): number | null {
  if (evPct == null || !Number.isFinite(evPct)) return null;
  return clamp(evPct / 2, 0, 10);
}

/** Monte Carlo hit (or confidence %) → 0–10 simulation-confidence score. */
export function simConfidenceToRankScore(
  simHit: number | null | undefined,
  confidencePct: number | null | undefined,
): number | null {
  if (simHit != null && Number.isFinite(simHit)) return clamp(simHit * 10, 0, 10);
  if (confidencePct != null && Number.isFinite(confidencePct)) {
    return clamp(confidencePct / 10, 0, 10);
  }
  return null;
}

function holisticFactor(
  holistic: PropHolisticScore | null | undefined,
  key: string,
): number | null {
  const f = holistic?.factors.find((x) => x.key === key);
  if (!f?.present || f.score == null) return null;
  return f.score;
}

function rubricScore(pick: ParsedPick, key: "matchup" | "trend" | "injury" | "lineShopping" | "lineValue") {
  return pick.finalAiScore?.rubric?.scores?.[key] ?? pick.scores?.scores?.[key] ?? null;
}

export function matchupQualityRankScore(pick: ParsedPick): number | null {
  const holistic = pick.finalAiScore?.propHolistic;
  if (holistic) {
    const matchup = holisticFactor(holistic, "matchup");
    const opponent = holisticFactor(holistic, "opponentTendency");
    const parts = [matchup, opponent].filter((s): s is number => s != null);
    if (parts.length) return parts.reduce((a, b) => a + b, 0) / parts.length;
  }
  return rubricScore(pick, "matchup");
}

export function recentFormRankScore(pick: ParsedPick): number | null {
  const holistic = pick.finalAiScore?.propHolistic;
  return holisticFactor(holistic, "recentForm") ?? rubricScore(pick, "trend");
}

export function injuryRankScore(pick: ParsedPick): number | null {
  const holistic = pick.finalAiScore?.propHolistic;
  return holisticFactor(holistic, "injury") ?? rubricScore(pick, "injury");
}

export function lineMovementRankScore(pick: ParsedPick): number | null {
  return holisticFactor(pick.finalAiScore?.propHolistic, "lineMovement");
}

export function marketEfficiencyRankScore(
  pick: ParsedPick,
  lineShoppingScore: number | null | undefined,
): number | null {
  const holistic = pick.finalAiScore?.propHolistic;
  const sportsbook = holisticFactor(holistic, "sportsbookValue");
  if (sportsbook != null) return sportsbook;
  const shop = lineShoppingScore ?? rubricScore(pick, "lineShopping");
  const value = rubricScore(pick, "lineValue");
  const parts = [shop, value].filter((s): s is number => s != null);
  if (parts.length) return parts.reduce((a, b) => a + b, 0) / parts.length;
  return null;
}

export function coachRankFactorScores(leg: BoardScoredLeg): Record<CoachRankFactorKey, number | null> {
  const pick = leg.pick;
  return {
    ev: evPctToRankScore(leg.evPct),
    simulation: simConfidenceToRankScore(leg.simHit, leg.confidencePct),
    matchup: matchupQualityRankScore(pick),
    recentForm: recentFormRankScore(pick),
    injury: injuryRankScore(pick),
    lineMovement: lineMovementRankScore(pick),
    marketEfficiency: marketEfficiencyRankScore(pick, leg.lineShoppingScore),
  };
}

/** Weighted 0–10 composite; missing factors reduce rank via partial weight sum. */
export function combineCoachRankFactors(
  factors: Partial<Record<CoachRankFactorKey, number | null>>,
): number | null {
  let acc = 0;
  let wSum = 0;
  for (const key of Object.keys(COACH_COMPOSITE_RANK_WEIGHTS) as CoachRankFactorKey[]) {
    const score = factors[key];
    if (score == null || !Number.isFinite(score)) continue;
    const w = COACH_COMPOSITE_RANK_WEIGHTS[key];
    wSum += w;
    acc += w * score;
  }
  if (wSum <= 0) return null;
  return Math.round((acc / wSum) * 100) / 100;
}

/** Sort key for board-scan staging — scales composite for stable greedy selection. */
export function coachCompositeRankScore(leg: BoardScoredLeg): number {
  const factors = coachRankFactorScores(leg);
  let acc = 0;
  let wSum = 0;
  for (const key of Object.keys(COACH_COMPOSITE_RANK_WEIGHTS) as CoachRankFactorKey[]) {
    const score = factors[key];
    if (score == null || !Number.isFinite(score)) continue;
    const w = COACH_COMPOSITE_RANK_WEIGHTS[key];
    wSum += w;
    acc += w * score;
  }
  if (wSum <= 0) {
    const ev = leg.evPct ?? 0;
    const edge = leg.edgePct ?? 0;
    const sim = (leg.simHit ?? 0) * 10;
    return Math.round((ev * 3.5 + edge * 2.5 + sim * 2.5) * 10) / 10;
  }
  // Penalize thin context: multiply by wSum so legs missing matchup/form rank lower.
  return Math.round(acc * wSum * 100) / 10;
}
