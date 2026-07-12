// AI recommendation gate — only markets that pass simulation + edge + EV + confidence.

import type { FinalAiScore } from "./finalAiScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  simEvPct,
} from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "./simMarketSupport.ts";

/** Softer confidence floor for alt legs promoted onto a reach-N ticket. */
export const ALT_PICK_MIN_CONFIDENCE = 50;

/** Reach-tier board fill when strict mains + alts cannot reach N. */
export const REACH_BOARD_MIN_CONFIDENCE = 48;
export const REACH_BOARD_MIN_GRADE = "C";

export const NOT_AI_RECOMMENDED = "Not AI Recommended";

export type RecommendablePick = {
  market?: string;
  isProp?: boolean;
  sport?: string;
  odds?: number | null;
  ticketRole?: "main" | "alt";
};

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

/** True when a pick passes all AI recommendation thresholds. */
export function pickIsAiRecommended(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (!score.simAligned && !score.highRiskValuePlay) return false;
  if (score.simHit != null && pick.odds != null) {
    const implied = impliedProb(pick.odds);
    if (score.simHit <= implied && !score.highRiskValuePlay) return false;
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0 && !score.highRiskValuePlay) return false;
  }
  return score.recommends;
}

/** Display label for pick card grade tile. */
export function pickGradeDisplayLabel(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): string | null {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) return null;
  if (!pickHasSimGrade(pick, score?.simHit)) return null;
  if (
    pick.ticketRole === "alt" &&
    (qualifiesAltPick(pick, score ?? undefined) ||
      qualifiesReachBoardPick(pick, score ?? undefined))
  ) {
    return score?.grade ?? null;
  }
  if (pickIsAiRecommended(pick, score ?? undefined)) return score?.grade ?? null;
  return NOT_AI_RECOMMENDED;
}

export function pickGradeDisplayCaption(
  pick: RecommendablePick & { simulationPending?: boolean },
  score: FinalAiScore | null | undefined,
): string {
  if (!marketSupportsSimulation(pick.market ?? "", pick)) {
    return "Simulation not available for this market yet";
  }
  if (pick.simulationPending) {
    return "Running 10k simulation…";
  }
  if (!pickHasSimGrade(pick, score?.simHit)) {
    return "Waiting for simulation result…";
  }
  if (
    pick.ticketRole === "alt" ||
    (pick as { propIsAlt?: boolean }).propIsAlt
  ) {
    if (qualifiesAltPick(pick, score ?? undefined)) {
      return "Alternate pick — positive EV, edge, and sim grade";
    }
    if (qualifiesReachBoardPick(pick, score ?? undefined)) {
      return "Reach fill — positive EV and edge on a sim-graded line";
    }
  }
  if (pickIsAiRecommended(pick, score ?? undefined)) {
    return "Passes sim, edge, EV, and confidence thresholds";
  }
  return "Did not pass AI recommendation thresholds";
}

/** Step-4 reach fill on a full-board scan — softer than main, honest vs junk. */
export function qualifiesReachBoardPick(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (gradeRank(score.grade) < gradeRank(REACH_BOARD_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < REACH_BOARD_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return true;
}

/** True when an alt rung passes the softer reach-N alt thresholds. */
export function qualifiesAltPick(
  pick: RecommendablePick,
  score: FinalAiScore | null | undefined,
): boolean {
  if (!score) return false;
  if (!pickHasSimGrade(pick, score.simHit)) return false;
  if (gradeRank(score.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if ((score.confidencePct ?? 0) < ALT_PICK_MIN_CONFIDENCE) return false;
  if ((score.edgePct ?? 0) <= 0) return false;
  if (score.simHit != null && pick.odds != null) {
    const ev = simEvPct(score.simHit, pick.odds);
    if (ev != null && ev <= 0) return false;
  }
  return true;
}

/** Main legs use the strict gate; staged alt legs use the softer alt gate. */
export function pickPassesTicketGate(
  pick: RecommendablePick & { ticketRole?: "main" | "alt" },
  score: FinalAiScore | null | undefined,
): boolean {
  if (pick.ticketRole === "alt") {
    return qualifiesAltPick(pick, score) || qualifiesReachBoardPick(pick, score);
  }
  return pickIsAiRecommended(pick, score);
}

/** Keep only legs that pass every AI recommendation threshold. */
export function filterAiRecommendedPicks<T extends RecommendablePick & { finalAiScore?: FinalAiScore | null }>(
  picks: T[],
): T[] {
  return picks.filter((p) => pickIsAiRecommended(p, p.finalAiScore));
}

/** Keep main legs that pass the strict gate and alt legs that pass the alt gate. */
export function filterTicketPicks<
  T extends RecommendablePick & { finalAiScore?: FinalAiScore | null; ticketRole?: "main" | "alt" },
>(picks: T[]): T[] {
  return picks.filter((p) => {
    if (!pickPassesTicketGate(p, p.finalAiScore)) return false;
    const edge = p.finalAiScore?.edgePct;
    if (edge != null && edge <= 0) return false;
    return true;
  });
}

/** Never zero a grounded ticket — keep qualifying alts or the strongest leg. */
export function filterTicketPicksPreservingTicket<
  T extends RecommendablePick & {
    finalAiScore?: FinalAiScore | null;
    ticketRole?: "main" | "alt";
    scores?: { composite?: number | null } | null;
  },
>(picks: T[]): T[] {
  const filtered = filterTicketPicks(picks);
  if (filtered.length > 0 || picks.length === 0) return filtered;
  const altFallback = picks.filter((p) => qualifiesAltPick(p, p.finalAiScore));
  if (altFallback.length > 0) return altFallback;
  return [];
}

export function countAiRecommendedPicks(
  picks: Array<RecommendablePick & { finalAiScore?: FinalAiScore | null }>,
): number {
  return picks.filter((p) => pickIsAiRecommended(p, p.finalAiScore)).length;
}
