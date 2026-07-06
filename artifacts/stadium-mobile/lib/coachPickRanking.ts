// Coach Final Score — unified ranking for AI Coach ticket selection.

import type { ParsedPick } from "../components/PickCard.tsx";
import { gradeRank } from "./finalAiScore.ts";
import type { PickSubScores } from "./pickScore.ts";
import { resolvePickEdgePct, type PickEdgeResolveOpts } from "./parlayQualifiedGate.ts";

/** Premium Coach floor — grade C+, confidence 60+, strictly positive edge. */
export const MIN_COACH_PREMIUM_CONFIDENCE = 60;

/** Near-tie band for Final Score (1–2% relative). */
export const COACH_FINAL_SCORE_TIE_PCT = 0.02;

/** Factor weights for Coach Final Score (renormalized over present signals). */
export const COACH_FINAL_SCORE_WEIGHTS: Record<string, number> = {
  grade: 0.15,
  confidence: 0.12,
  edge: 0.18,
  modelProbability: 0.15,
  priceValue: 0.15,
  matchup: 0.12,
  marketLiquidity: 0.08,
  injuryCertainty: 0.05,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function rubricSub(pick: ParsedPick, key: keyof PickSubScores): number | null {
  const v = pick.finalAiScore?.rubric?.scores?.[key] ?? pick.scores?.scores?.[key];
  return v != null && Number.isFinite(v) ? v : null;
}

function gradeFactor10(grade: string | null | undefined): number | null {
  const r = gradeRank(grade);
  return r >= 0 ? r : null;
}

function edgeFactor10(edge: number | null): number | null {
  if (edge == null || !Number.isFinite(edge) || edge <= 0) return null;
  return Math.min(10, edge * 2);
}

function modelProbabilityFactor10(pick: ParsedPick): number | null {
  const sim = pick.finalAiScore?.simHit;
  if (sim != null && Number.isFinite(sim)) return Math.min(10, sim * 10);
  return rubricSub(pick, "simulation");
}

/**
 * Coach Final Score — blends grade, confidence, edge, model probability,
 * price value, matchup, market liquidity, and injury certainty.
 * Returns 0–10 or null when insufficient data.
 */
export function computeCoachFinalScore(
  pick: ParsedPick,
  opts?: PickEdgeResolveOpts,
): number | null {
  const s = pick.finalAiScore;
  if (!s) return null;

  const edge = resolvePickEdgePct(pick, opts);
  const factors: Array<{ w: number; v: number | null }> = [
    { w: COACH_FINAL_SCORE_WEIGHTS.grade!, v: gradeFactor10(s.grade) },
    {
      w: COACH_FINAL_SCORE_WEIGHTS.confidence!,
      v: s.confidencePct != null ? s.confidencePct / 10 : null,
    },
    { w: COACH_FINAL_SCORE_WEIGHTS.edge!, v: edgeFactor10(edge) },
    { w: COACH_FINAL_SCORE_WEIGHTS.modelProbability!, v: modelProbabilityFactor10(pick) },
    { w: COACH_FINAL_SCORE_WEIGHTS.priceValue!, v: rubricSub(pick, "lineValue") },
    { w: COACH_FINAL_SCORE_WEIGHTS.matchup!, v: rubricSub(pick, "matchup") },
    { w: COACH_FINAL_SCORE_WEIGHTS.marketLiquidity!, v: rubricSub(pick, "lineShopping") },
    { w: COACH_FINAL_SCORE_WEIGHTS.injuryCertainty!, v: rubricSub(pick, "injury") },
  ];

  let wSum = 0;
  let acc = 0;
  for (const f of factors) {
    if (f.v == null) continue;
    wSum += f.w;
    acc += f.w * f.v;
  }
  if (wSum <= 0) return null;
  return round2(acc / wSum);
}

export function coachFinalScoresNear(a: number, b: number): boolean {
  const peak = Math.max(a, b, 0.01);
  return Math.abs(a - b) / peak <= COACH_FINAL_SCORE_TIE_PCT;
}

/** Compare picks by Coach Final Score; tie-break confidence, edge, then diversity load. */
export function compareCoachPicksByFinalScore(
  a: ParsedPick,
  b: ParsedPick,
  opts?: PickEdgeResolveOpts & { diversityLoad?: (p: ParsedPick) => number },
): number {
  const sa = computeCoachFinalScore(a, opts);
  const sb = computeCoachFinalScore(b, opts);
  if (sa != null && sb != null && !coachFinalScoresNear(sa, sb)) {
    return sb - sa;
  }

  const confA = a.finalAiScore?.confidencePct ?? 0;
  const confB = b.finalAiScore?.confidencePct ?? 0;
  if (confB !== confA) return confB - confA;

  const edgeA = resolvePickEdgePct(a, opts) ?? -999;
  const edgeB = resolvePickEdgePct(b, opts) ?? -999;
  if (edgeB !== edgeA) return edgeB - edgeA;

  if (opts?.diversityLoad) {
    const loadA = opts.diversityLoad(a);
    const loadB = opts.diversityLoad(b);
    if (loadA !== loadB) return loadA - loadB;
  }

  if (sa != null && sb != null && sb !== sa) return sb - sa;
  return 0;
}
