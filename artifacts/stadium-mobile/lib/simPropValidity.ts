// Monte Carlo prop simulation validity, consistency checks, and display helpers.
import type { PropSimulationResult } from "./api";
import { americanToImplied, gradeFromComposite, type CombinedPickScore } from "./pickScore";
import { resolveSimConfidence } from "./propSimFallback";

export const DEEP_SIM_TARGET = 10_000;

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

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function isServerMonteCarlo(row: PropSimulationResult | null | undefined): boolean {
  if (!row) return false;
  const completed = row.completedSims ?? row.simulations ?? 0;
  return completed > 0 && row.hitProbability != null && Number.isFinite(row.hitProbability);
}

/** True when the backend completed the full deep Monte Carlo draw count. */
export function isDeepMonteCarloComplete(
  row: PropSimulationResult | null | undefined,
  target = DEEP_SIM_TARGET,
): boolean {
  if (!row?.hitProbability || !Number.isFinite(row.hitProbability)) return false;
  const completed = row.completedSims ?? row.simulations ?? 0;
  return completed >= target && (row.failedSims ?? 0) === 0;
}

/** Hit rate and likely projection must agree for the picked side. */
export function isSimProjectionConsistent(row: PropSimulationResult): boolean {
  const hit = row.hitProbability;
  const proj = row.meanProjection ?? row.medianProjection ?? row.mostLikelyLine;
  if (hit == null || !Number.isFinite(hit)) return false;
  if (proj == null || !Number.isFinite(proj)) return false;

  const line = row.line;
  const margin = proj - line;
  if (row.side === "Over") {
    if (margin < -0.75 && hit > 0.55) return false;
    if (margin > 1.5 && hit < 0.35) return false;
  } else {
    if (margin > 0.75 && hit > 0.55) return false;
    if (margin < -1.5 && hit < 0.35) return false;
  }
  return true;
}

/** Prop has grounded sim hit, sim confidence, projection, and internal consistency. */
export function isValidPropSimData(row: PropSimulationResult | null | undefined): boolean {
  if (!row) return false;
  if (row.hitProbability == null || !Number.isFinite(row.hitProbability)) return false;
  if (resolveSimConfidence(row) == null) return false;
  const proj = row.meanProjection ?? row.medianProjection ?? row.mostLikelyLine;
  if (proj == null || !Number.isFinite(proj)) return false;
  return isSimProjectionConsistent(row);
}

/** Strong non-sim factors that can justify a modest grade bump on very low sim hit. */
export function hasStrongNonSimJustification(combined: CombinedPickScore): boolean {
  const edge = combined.edgePct ?? 0;
  const lineValue = combined.scores.lineValue;
  const trend = combined.scores.trend;
  return (
    edge >= 4 &&
    lineValue != null &&
    lineValue >= 7.5 &&
    trend != null &&
    trend >= 6.5
  );
}

function compositeCapForGrade(grade: string): number {
  const caps: Record<string, number> = {
    "B-": 6.9,
    B: 7.4,
    "C+": 6.4,
    "C-": 5.4,
    D: 4.9,
  };
  return caps[grade] ?? 5.5;
}

/**
 * Cap AI grade when Monte Carlo hit rate contradicts a high rubric score.
 * Low sim hit (10–20%) cannot produce a high grade unless edge + trend clearly justify it.
 */
export function capGradeForSimHit(
  combined: CombinedPickScore,
  simRow: PropSimulationResult | null | undefined,
): CombinedPickScore {
  if (!simRow?.hitProbability || !Number.isFinite(simRow.hitProbability)) return combined;
  if (!isServerMonteCarlo(simRow) && !isValidPropSimData(simRow)) return combined;

  const hit = simRow.hitProbability;
  const justified = hasStrongNonSimJustification(combined);

  let maxGrade: string | null = null;
  if (hit < 0.2) maxGrade = justified ? "B-" : "D";
  else if (hit < 0.35) maxGrade = justified ? "C+" : "C-";
  else if (hit < 0.52) maxGrade = justified ? "B" : "C+";

  if (!maxGrade || combined.grade == null) return combined;
  if (gradeRank(combined.grade) <= gradeRank(maxGrade)) return combined;

  const cappedComposite =
    combined.composite != null
      ? Math.min(combined.composite, compositeCapForGrade(maxGrade))
      : compositeCapForGrade(maxGrade);
  const grade = gradeFromComposite(cappedComposite);
  return {
    ...combined,
    composite: cappedComposite,
    grade,
    confidencePct:
      combined.confidencePct != null
        ? Math.min(combined.confidencePct, clamp(Math.round(cappedComposite * 10), 5, 95))
        : combined.confidencePct,
  };
}

/** Betting edge when present; otherwise derive from price + sim hit or sim-only fair value. */
export function resolveDisplayEdge(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
  oddsAmerican?: number | null,
): number | null {
  if (combined?.edgePct != null && Number.isFinite(combined.edgePct)) {
    return combined.edgePct;
  }
  const hit = simRow?.hitProbability;
  if (hit == null || !Number.isFinite(hit)) return null;

  const implied = americanToImplied(oddsAmerican);
  if (implied != null && Number.isFinite(implied)) {
    return round1(clamp((hit - implied) * 100, -25, 25));
  }

  if (isServerMonteCarlo(simRow) || isValidPropSimData(simRow)) {
    return round1(clamp((hit - 0.5) * 100, -25, 25));
  }
  return null;
}

export function simConfidenceFromMonteCarlo(
  hitProbability: number,
  completedSims: number,
): number {
  let confidence = 52;
  if (completedSims >= 10_000) confidence += 20;
  else if (completedSims >= 5_000) confidence += 14;
  else if (completedSims >= 1_000) confidence += 8;
  confidence += Math.abs(hitProbability - 0.5) * 48;
  return clamp(Math.round(confidence), 5, 95);
}
