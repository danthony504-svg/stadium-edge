// Pure coach leg quality checks — no React Native / pool dependencies (testable).

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropSimulationResult } from "./api.ts";
import type { CombinedPickScore } from "./pickScore.ts";
import { americanToImplied } from "./pickScore.ts";
import { propDualScoreRecommends, type PropDualScore } from "./propDualScore.ts";

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}

export const COACH_MIN_GRADE = "B+";
export const COACH_MIN_GRADE_RANK = gradeRank(COACH_MIN_GRADE);
export const COACH_MIN_CONFIDENCE_PCT = 55;
export const COACH_MIN_SIM_HIT = 0.52;
export const COACH_MIN_SUBSCORE = 5.5;
export const COACH_INJURY_FLOOR = 5.0;

export type CoachQualityFailure =
  | "no_grade"
  | "low_grade"
  | "low_confidence"
  | "no_edge"
  | "no_sim"
  | "invalid_sim"
  | "low_sim_hit"
  | "weak_matchup"
  | "weak_form"
  | "injury_concern"
  | "weak_line_shopping"
  | "dual_score";

export type CoachQualityResult = {
  passes: boolean;
  failures: CoachQualityFailure[];
};

function effectiveEdge(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null,
  odds?: number,
): number | null {
  if (combined?.edgePct != null && Number.isFinite(combined.edgePct)) {
    return combined.edgePct;
  }
  const hit = simRow?.hitProbability;
  if (hit == null || !Number.isFinite(hit)) return null;
  const implied = americanToImplied(odds);
  if (implied != null) return Math.round((hit - implied) * 1000) / 10;
  return Math.round((hit - 0.5) * 1000) / 10;
}

function simSupportsProp(simRow: PropSimulationResult | null): boolean {
  if (!simRow?.hitProbability || !Number.isFinite(simRow.hitProbability)) return false;
  const completed = simRow.completedSims ?? simRow.simulations ?? 0;
  if (completed <= 0 || (simRow.failedSims ?? 0) > 0) return false;
  const proj = simRow.meanProjection ?? simRow.medianProjection ?? simRow.mostLikelyLine;
  return proj != null && Number.isFinite(proj);
}

/** Strict quality gate — every check must pass; absent optional signals are OK. */
export function evaluateCoachLegQuality(
  pick: ParsedPick,
  simRow: PropSimulationResult | null,
  dual?: PropDualScore | null,
): CoachQualityResult {
  const failures: CoachQualityFailure[] = [];
  const scores = pick.scores;
  const grade = scores?.grade ?? null;

  if (!grade) failures.push("no_grade");
  else if (gradeRank(grade) < COACH_MIN_GRADE_RANK) failures.push("low_grade");

  const conf = scores?.confidencePct;
  if (conf == null || conf < COACH_MIN_CONFIDENCE_PCT) failures.push("low_confidence");

  const edge = effectiveEdge(scores, simRow, pick.odds);
  if (edge == null || edge <= 0) failures.push("no_edge");

  if (pick.isProp) {
    if (!simRow) failures.push("no_sim");
    else if (!simSupportsProp(simRow)) failures.push("invalid_sim");
    else if (
      simRow.hitProbability == null ||
      simRow.hitProbability < COACH_MIN_SIM_HIT
    ) {
      failures.push("low_sim_hit");
    }
  }

  const sub = scores?.scores;
  if (sub?.matchup != null && sub.matchup < COACH_MIN_SUBSCORE) failures.push("weak_matchup");
  if (sub?.trend != null && sub.trend < COACH_MIN_SUBSCORE) failures.push("weak_form");
  if (sub?.injury != null && sub.injury < COACH_INJURY_FLOOR) failures.push("injury_concern");
  if (sub?.lineShopping != null && sub.lineShopping < COACH_MIN_SUBSCORE) {
    failures.push("weak_line_shopping");
  }

  if (
    pick.isProp &&
    dual &&
    dual.playerScore != null &&
    dual.matchupScore != null &&
    !propDualScoreRecommends(dual)
  ) {
    failures.push("dual_score");
    if (!dual.passesPlayer && !failures.includes("weak_form")) failures.push("weak_form");
    if (!dual.passesMatchup && !failures.includes("weak_matchup")) failures.push("weak_matchup");
  }

  return { passes: failures.length === 0, failures };
}
