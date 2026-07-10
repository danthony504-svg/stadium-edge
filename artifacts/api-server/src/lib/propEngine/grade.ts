// Universal prop grading — edge, EV, composite, AI grade, recommend/skip gate.

import type { PropGrade, PropLine, PropSimResult } from "./types.js";

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};
export const PROP_ENGINE_MIN_GRADE = "B+";
const HIGH_RISK_EDGE_MIN = 4.5;
const GAME_SIM_MIN_HIT = 0.52;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function americanToProb(price: number): number {
  if (price > 0) return 100 / (price + 100);
  return (-price) / (-price + 100);
}

function americanToDecimal(price: number): number {
  if (price > 0) return 1 + price / 100;
  return 1 + 100 / -price;
}

function gradeFromComposite(composite: number | null): string | null {
  if (composite == null || !Number.isFinite(composite)) return null;
  if (composite >= 9) return "A+";
  if (composite >= 8.2) return "A";
  if (composite >= 7.5) return "A-";
  if (composite >= 6.8) return "B+";
  if (composite >= 6) return "B";
  if (composite >= 5.2) return "B-";
  if (composite >= 4.5) return "C+";
  if (composite >= 3.8) return "C";
  return "D";
}

function gradeRank(g: string | null): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

function scoreSimulation(simHit: number | null): number | null {
  if (simHit == null) return null;
  return Math.round(clamp(simHit * 10, 1, 10) * 10) / 10;
}

export type GradePropInput = {
  line: PropLine;
  sim: PropSimResult;
  fairProb?: number | null;
  learningWeight?: number;
};

export function gradeProp(input: GradePropInput): PropGrade {
  const { line, sim } = input;
  const implied = americanToProb(line.odds);
  const fair = input.fairProb ?? line.fairProb ?? sim.hitProbability ?? null;

  const edgePct =
    line.edgePct != null
      ? line.edgePct
      : fair != null
        ? Math.round((fair - implied) * 1000) / 10
        : null;

  const evPct =
    line.evPct != null
      ? line.evPct
      : fair != null
        ? Math.round((fair * americanToDecimal(line.odds) - 1) * 1000) / 10
        : null;

  const simHit = sim.hitProbability;
  const simScore = scoreSimulation(simHit);
  const lineValueScore = edgePct != null ? clamp(5 + edgePct / 2, 1, 10) : null;
  const trendScore =
    sim.confidenceScore != null ? clamp(sim.confidenceScore / 10, 1, 10) : 5;

  const factors = [simScore, lineValueScore, trendScore].filter(
    (x): x is number => x != null && Number.isFinite(x),
  );
  const composite =
    factors.length > 0
      ? Math.round((factors.reduce((a, b) => a + b, 0) / factors.length) * 10) / 10
      : null;

  const lw = input.learningWeight ?? 1;
  const adjusted = composite != null ? Math.round(composite * lw * 10) / 10 : null;
  const grade = gradeFromComposite(adjusted ?? composite);

  const simAligned = simHit == null || simHit >= GAME_SIM_MIN_HIT;
  const highRiskValuePlay = !simAligned && (edgePct ?? 0) >= HIGH_RISK_EDGE_MIN;

  const recommends =
    gradeRank(grade) >= gradeRank(PROP_ENGINE_MIN_GRADE) &&
    (edgePct ?? 0) > 0 &&
    (simAligned || highRiskValuePlay);

  let skipReason: string | null = null;
  if (!recommends) {
    if ((edgePct ?? 0) <= 0) skipReason = "No positive edge vs book";
    else if (gradeRank(grade) < gradeRank(PROP_ENGINE_MIN_GRADE))
      skipReason = `Grade ${grade ?? "—"} below ${PROP_ENGINE_MIN_GRADE} threshold`;
    else if (!simAligned && !highRiskValuePlay)
      skipReason = `Sim hit ${simHit != null ? Math.round(simHit * 100) : "—"}% too low`;
    else skipReason = "Failed quality gate";
  }

  return {
    edgePct,
    evPct,
    fairProb: fair,
    simHit,
    composite: adjusted ?? composite,
    grade,
    confidencePct: sim.confidenceScore != null ? Math.round(sim.confidenceScore) : null,
    recommends,
    skipReason,
  };
}

export function rankPropRecommendation(rec: {
  grade: PropGrade;
  adjustedComposite: number | null;
}): number {
  const g = rec.grade;
  const ev = g.evPct ?? 0;
  const conf = g.confidencePct ?? 50;
  const sim = g.simHit ?? 0.5;
  const adj = rec.adjustedComposite ?? g.composite ?? 0;
  return adj * 10 + ev * 0.5 + conf * 0.05 + sim * 20;
}
