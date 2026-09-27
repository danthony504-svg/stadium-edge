/** 1–10 sub-score or null when not groundable. */
export type GradeSubScore = number | null;

export type GradeSubScores = {
  simulation: GradeSubScore;
  lineValue: GradeSubScore;
  matchup: GradeSubScore;
  trends: GradeSubScore;
  injury: GradeSubScore;
  lineMovement: GradeSubScore;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Letter grade from the 1–10 composite — same thresholds as the mobile rubric. */
export function gradeFromComposite(composite: number | null): string | null {
  if (composite == null) return null;
  if (composite >= 9.0) return "A+";
  if (composite >= 8.5) return "A";
  if (composite >= 8.0) return "A-";
  if (composite >= 7.5) return "B+";
  if (composite >= 7.0) return "B";
  if (composite >= 6.5) return "B-";
  if (composite >= 6.0) return "C+";
  if (composite >= 5.5) return "C";
  if (composite >= 5.0) return "C-";
  if (composite >= 4.0) return "D";
  return "F";
}

const CONFIDENCE_BASELINE = 50;
const CONFIDENCE_NEUTRAL = 5.5;
const CONFIDENCE_PER_FACTOR = 10;

/** Breadth-weighted conviction score (0–100) from present sub-scores. */
export function confidenceFromSubScores(scores: GradeSubScores): number | null {
  let present = 0;
  let pts = CONFIDENCE_BASELINE;
  for (const s of Object.values(scores)) {
    if (s != null && Number.isFinite(s)) {
      present += 1;
      pts += ((s - CONFIDENCE_NEUTRAL) / (10 - CONFIDENCE_NEUTRAL)) * CONFIDENCE_PER_FACTOR;
    }
  }
  if (present === 0) return null;
  return clamp(Math.round(pts), 5, 95);
}

/** Public 0–100 composite for ranking (internal rubric is 1–10). */
export function compositeToDisplayScore(composite: number): number {
  return Math.round(composite * 10 * 10) / 10;
}
