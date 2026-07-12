export type CoachGradeWeights = {
  simulation: number;
  lineValue: number;
  matchup: number;
  trends: number;
  injury: number;
  lineMovement: number;
};

export type CoachGradeResult = {
  compositeScore: number;
  grade: string;
  confidencePct: number;
  weights: CoachGradeWeights;
  breakdown: Record<string, number>;
};
