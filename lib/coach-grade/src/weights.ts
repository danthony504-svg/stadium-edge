import type { CoachGradeWeights } from "@workspace/coach-types";

/** Default factor weights — renormalized over present sub-scores only. */
export const COACH_GRADE_WEIGHTS: CoachGradeWeights = {
  simulation: 0.3,
  lineValue: 0.22,
  matchup: 0.18,
  trends: 0.15,
  injury: 0.1,
  lineMovement: 0.05,
};
