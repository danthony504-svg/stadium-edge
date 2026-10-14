import type { GradeSubScore } from "./letterGrade";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreLineValue(edgePct: number | null | undefined): GradeSubScore {
  if (edgePct == null || !Number.isFinite(edgePct)) return null;
  return round1(clamp(5.5 + edgePct * 0.45, 1, 9.9));
}

export function scoreMatchup(
  aligned: 1 | 0 | -1 | null,
  leanEdge: number,
): GradeSubScore {
  if (aligned == null) return null;
  const mag = clamp(Number.isFinite(leanEdge) ? leanEdge : 0, 0, 5);
  return round1(clamp(5.5 + aligned * mag * 0.7, 1, 10));
}

export function scoreTrend(momentum: number | null | undefined): GradeSubScore {
  if (momentum == null || !Number.isFinite(momentum)) return null;
  return round1(clamp(5.5 + clamp(momentum, -1, 1) * 3.5, 1, 10));
}

export function scoreInjury(favor: number | null | undefined): GradeSubScore {
  if (favor == null || !Number.isFinite(favor)) return null;
  return round1(clamp(5.5 + clamp(favor, -1, 1) * 3, 1, 10));
}

export function scoreSimulation(hitProbability: number | null | undefined): GradeSubScore {
  if (hitProbability == null || !Number.isFinite(hitProbability)) return null;
  return round1(clamp(5.5 + (clamp(hitProbability, 0, 1) - 0.5) * 9, 1, 10));
}

export function scoreLineMovement(
  direction: "toward" | "against" | "neutral" | null | undefined,
  magnitudePct?: number | null,
): GradeSubScore {
  if (direction == null) return null;
  if (direction === "neutral") return 5.5;
  if (direction === "against") return round1(clamp(5.5 - clamp(magnitudePct ?? 0, 0, 5) * 0.4, 1, 5));
  const mag = clamp(magnitudePct ?? 0, 0, 5);
  return round1(clamp(5.5 + mag * 0.35, 5.5, 9));
}
