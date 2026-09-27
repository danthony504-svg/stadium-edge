import type { CoachCandidateLeg, CoachGradeResult, CoachSimResult, CoachSportGradeHook } from "@workspace/coach-types";
import type { CoachGateEvaluationContext } from "@workspace/coach-gates";
import { matchupAlignment } from "@workspace/coach-gates";

import {
  compositeToDisplayScore,
  confidenceFromSubScores,
  gradeFromComposite,
  type GradeSubScores,
} from "./letterGrade";
import {
  scoreInjury,
  scoreLineMovement,
  scoreLineValue,
  scoreMatchup,
  scoreSimulation,
  scoreTrend,
} from "./scorers";
import { COACH_GRADE_WEIGHTS } from "./weights";

export type CoachGradeInput = {
  candidate: CoachCandidateLeg;
  sim: CoachSimResult;
  context: CoachGateEvaluationContext;
  weights?: typeof COACH_GRADE_WEIGHTS;
  gradeHook?: CoachSportGradeHook;
  sportContext?: Parameters<CoachSportGradeHook>[2];
};

export function buildGradeSubScores(
  candidate: CoachCandidateLeg,
  sim: CoachSimResult,
  context: CoachGateEvaluationContext,
): GradeSubScores {
  const matchup = context.matchup;
  const pickTeam = matchup?.pickTeam ?? null;
  const { aligned, leanEdge } = matchupAlignment(matchup?.mlLean ?? null, pickTeam);

  return {
    simulation: scoreSimulation(sim.hitProbability),
    lineValue: scoreLineValue(sim.edgePct),
    matchup:
      candidate.kind === "player_prop" && aligned == null
        ? scoreMatchup(0, 0)
        : scoreMatchup(aligned, leanEdge),
    trends: scoreTrend(context.trends?.momentum),
    injury: scoreInjury(context.injuries?.favor),
    lineMovement: scoreLineMovement(
      context.lineMovement?.direction,
      context.lineMovement?.magnitudePct,
    ),
  };
}

function combineWeightedSubScores(
  scores: GradeSubScores,
  weights: typeof COACH_GRADE_WEIGHTS,
): { composite: number | null; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let wSum = 0;
  let acc = 0;

  for (const key of Object.keys(weights) as Array<keyof typeof COACH_GRADE_WEIGHTS>) {
    const sub = scores[key];
    if (sub != null && Number.isFinite(sub)) {
      breakdown[key] = sub;
      wSum += weights[key];
      acc += weights[key] * sub;
    }
  }

  const composite = wSum > 0 ? Math.round((acc / wSum) * 10) / 10 : null;
  return { composite, breakdown };
}

function confidenceFromSim(sim: CoachSimResult): number | null {
  const raw = sim.distributionSummary?.confidenceScore;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

/**
 * Composite grade for a gate-qualified leg. Learning hooks may nudge rank/confidence
 * but must never bypass gates.
 */
export function computeCoachGrade(input: CoachGradeInput): CoachGradeResult {
  const weights = input.weights ?? COACH_GRADE_WEIGHTS;
  const subScores = buildGradeSubScores(input.candidate, input.sim, input.context);
  const { composite, breakdown } = combineWeightedSubScores(subScores, weights);

  if (composite == null) {
    throw new Error("Cannot grade leg with no groundable sub-scores");
  }

  const grade = gradeFromComposite(composite);
  if (!grade) {
    throw new Error("Composite produced no letter grade");
  }

  const signalConfidence = confidenceFromSubScores(subScores);
  const simConfidence = confidenceFromSim(input.sim);
  const confidencePct = simConfidence ?? signalConfidence ?? 50;

  let result: CoachGradeResult = {
    compositeScore: compositeToDisplayScore(composite),
    grade,
    confidencePct,
    weights,
    breakdown,
  };

  if (input.gradeHook && input.sportContext) {
    result = input.gradeHook(input.candidate, result, input.sportContext);
  }

  return result;
}
