// AI recommendation gate — only markets that pass simulation + edge + EV + confidence.

import type { FinalAiScore } from "./finalAiScore.ts";
import { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE } from "./gameSimQualityGates.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "./simMarketSupport.ts";

export const NOT_AI_RECOMMENDED = "Not AI Recommended";

export type RecommendablePick = {
  market?: string;
  isProp?: boolean;
  sport?: string;
  odds?: number | null;
};

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

/** True when a pick passes all AI recommendation thresholds. */
export function pickIsAiRecommended(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (!score.simAligned && !score.highRiskValuePlay) return false;
  if (score.simHit != null && pick.odds != null) {
    const implied = impliedProb(pick.odds);
    if (score.simHit <= implied && !score.highRiskValuePlay) return false;
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0 && !score.highRiskValuePlay) return false;
  }
  return score.recommends;
}

/** Display label for pick card grade tile. */
export function pickGradeDisplayLabel(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): string | null {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) return null;
  if (!pickHasSimGrade(pick, score?.simHit)) return null;
  if (pickIsAiRecommended(pick, score ?? undefined)) return score?.grade ?? null;
  return NOT_AI_RECOMMENDED;
}

export function pickGradeDisplayCaption(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): string {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) {
    return "Simulation not available for this market yet";
  }
  if (!pickHasSimGrade(pick, score?.simHit)) {
    return "Simulation not available for this market yet";
  }
  if (pickIsAiRecommended(pick, score ?? undefined)) {
    return "Passes sim, edge, EV, and confidence thresholds";
  }
  return "Did not pass AI recommendation thresholds";
}
