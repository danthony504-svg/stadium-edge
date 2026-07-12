// Server-side leg qualification — mirrors mobile boardLegPoolRole / propBoardFillQualifies.

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

/** Whether a server-scored leg may enter staging (main or alt). */
export function serverBoardLegQualifies(
  pick: ParsedPick,
  score: ParsedPick["finalAiScore"] | null | undefined,
): boolean {
  if (!score || score.highRiskValuePlay) return false;
  const simHit = score.simHit;
  if (simHit == null || !Number.isFinite(simHit) || simHit <= 0 || simHit >= 1) {
    return false;
  }
  const edgePct = score.edgePct ?? 0;
  if (edgePct <= 0) return false;

  if (pick.isProp) {
    if (simHit < 0.52) return false;
    if (score.recommends) return true;
    if (gradeRank(score.grade) < gradeRank("C+")) return false;
    if (!simEvPositive(simHit, pick.odds)) return false;
    if ((score.confidencePct ?? 0) >= 48) return true;
    return false;
  }

  if (score.recommends) return true;
  if (score.simAligned && edgePct > 0) return true;
  return false;
}
