// Server-side leg qualification — mirrors mobile boardLegPoolRole quality gates.

import type { ParsedPick } from "./coachSlateTypes.js";

const GRADE_RANK: Record<string, number> = {
  "A+": 10,
  A: 9,
  "A-": 8,
  "B+": 7,
  B: 6,
  "B-": 5,
  "C+": 4,
  C: 3,
  "C-": 2,
  D: 1,
  F: 0,
};

function gradeRank(g: string | null | undefined): number {
  return GRADE_RANK[String(g ?? "").trim()] ?? 0;
}

function americanImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function simEvPositive(simHit: number, odds: number): boolean {
  const implied = americanImplied(odds);
  if (simHit <= implied) return false;
  const ev =
    simHit * (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) -
    (1 - simHit);
  return ev > 0;
}

export type ServerLegRejectionReason =
  | "missing_ai_score"
  | "high_risk"
  | "invalid_simulation"
  | "non_positive_edge"
  | "low_simulation_probability"
  | "low_grade"
  | "non_positive_ev"
  | "low_confidence"
  | "sim_not_aligned";

export function explainServerBoardLegQualification(
  pick: ParsedPick,
  score: ParsedPick["finalAiScore"] | null | undefined,
): { qualifies: boolean; reason?: ServerLegRejectionReason } {
  if (!score) return { qualifies: false, reason: "missing_ai_score" };
  if (score.highRiskValuePlay) return { qualifies: false, reason: "high_risk" };
  const simHit = score.simHit;
  if (simHit == null || !Number.isFinite(simHit) || simHit <= 0 || simHit >= 1) {
    return { qualifies: false, reason: "invalid_simulation" };
  }
  const edgePct = score.edgePct ?? 0;
  if (edgePct <= 0) return { qualifies: false, reason: "non_positive_edge" };

  if (pick.isProp) {
    if (simHit < 0.52) return { qualifies: false, reason: "low_simulation_probability" };
    if (score.recommends) return { qualifies: true };
    if (gradeRank(score.grade) < gradeRank("C+")) return { qualifies: false, reason: "low_grade" };
    if (!simEvPositive(simHit, pick.odds)) return { qualifies: false, reason: "non_positive_ev" };
    if ((score.confidencePct ?? 0) < 52) return { qualifies: false, reason: "low_confidence" };
    return { qualifies: true };
  }

  if (score.recommends || score.simAligned) return { qualifies: true };
  return { qualifies: false, reason: "sim_not_aligned" };
}

/** Whether a server-scored leg may enter staging (main or alt). */
export function serverBoardLegQualifies(
  pick: ParsedPick,
  score: ParsedPick["finalAiScore"] | null | undefined,
): boolean {
  return explainServerBoardLegQualification(pick, score).qualifies;
}
