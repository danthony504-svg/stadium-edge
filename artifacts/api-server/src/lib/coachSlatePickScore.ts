import type { ParsedPick } from "./coachSlateTypes.js";

function americanImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

export function serverPickFinalAiScore(
  simHit: number | null,
  odds: number,
  edge: number | null | undefined,
): ParsedPick["finalAiScore"] {
  if (simHit == null || !Number.isFinite(simHit)) return undefined;
  const implied = americanImplied(odds);
  const simAligned = simHit > implied;
  const edgePct = edge ?? Math.round((simHit - implied) * 1000) / 10;
  const grade = simHit >= 0.58 ? "B" : simHit >= 0.54 ? "B-" : "C+";
  const confidencePct = Math.round(simHit * 100);
  const recommends = simAligned && edgePct > 0 && simHit >= 0.52;
  return {
    composite: Math.round((simHit * 100 + edgePct) * 10) / 10,
    grade,
    confidencePct,
    edgePct,
    simHit,
    simAligned,
    highRiskValuePlay: false,
    recommends,
    factors: [],
    rubric: { composite: Math.round(simHit * 100), grade, confidencePct, edgePct, scores: {} as never },
  };
}

export function serverPickRankScore(odds: number, edge: number | undefined, simHit: number | null | undefined): number {
  const edgeVal = edge != null && Number.isFinite(edge) ? edge : 0;
  const oddsBoost = Math.min(30, Math.abs(odds) / 50);
  return edgeVal * 2 + (simHit ?? 0) * 100 + oddsBoost;
}
