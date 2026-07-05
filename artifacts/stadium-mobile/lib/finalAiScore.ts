// Final AI Score — one composite built from simulation + all grounded rubric signals.
// Coach and Simulator share this module so recommendations never diverge.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  combinePickScore,
  scoreSimulation,
  type CombinedPickScore,
  type PickSubScores,
} from "./pickScore.ts";
import {
  GAME_SIM_MIN_HIT,
  gameSimHitForPick,
  gameSimHasValidRun,
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";

/** Minimum no-vig edge (pct pts) to keep a sim-opposed leg as High-Risk Value Play. */
export const HIGH_RISK_EDGE_MIN = 4.5;

export const FINAL_AI_MIN_GRADE = "B+";
const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

export type FinalAiFactor = {
  key: string;
  label: string;
  score: number | null;
  display?: string;
};

export type FinalAiScore = {
  composite: number | null;
  grade: string | null;
  confidencePct: number | null;
  edgePct: number | null;
  simHit: number | null;
  simAligned: boolean;
  highRiskValuePlay: boolean;
  recommends: boolean;
  factors: FinalAiFactor[];
  rubric: CombinedPickScore;
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export function simHitForPick(
  pick: ParsedPick,
  gameSim: CoachGameSimEntry | null | undefined,
  propSimHit: number | null | undefined,
): number | null {
  if (pick.isProp) {
    return propSimHit != null && Number.isFinite(propSimHit) ? propSimHit : null;
  }
  if (!isGameLinePick(pick)) return null;
  return gameSimHitForPick(pick, gameSim);
}

export function classifySimAlignment(
  simHit: number | null,
  edgePct: number | null,
): { simAligned: boolean; highRiskValuePlay: boolean } {
  if (simHit == null) return { simAligned: true, highRiskValuePlay: false };
  if (simHit >= GAME_SIM_MIN_HIT) return { simAligned: true, highRiskValuePlay: false };
  const edge = edgePct ?? 0;
  if (edge >= HIGH_RISK_EDGE_MIN) {
    return { simAligned: false, highRiskValuePlay: true };
  }
  return { simAligned: false, highRiskValuePlay: false };
}

export function buildFinalAiScore(input: {
  pick: ParsedPick;
  rubricScores: PickSubScores;
  edgePct: number | null;
  odds?: number | null;
  fairProb?: number | null;
  gameSim?: CoachGameSimEntry | null;
  propSimHit?: number | null;
}): FinalAiScore {
  const simHit = simHitForPick(input.pick, input.gameSim, input.propSimHit);
  const rubric = combinePickScore(
    input.rubricScores,
    input.edgePct,
    input.odds,
    input.fairProb,
  );

  const { simAligned, highRiskValuePlay } = classifySimAlignment(simHit, rubric.edgePct);

  const factors: FinalAiFactor[] = [
    {
      key: "simulation",
      label: "Simulation",
      score: scoreSimulation(simHit),
      display: simHit != null ? `${Math.round(simHit * 100)}% hit` : undefined,
    },
    {
      key: "lineValue",
      label: "Line Value",
      score: input.rubricScores.lineValue,
      display:
        rubric.edgePct != null ? `${rubric.edgePct > 0 ? "+" : ""}${rubric.edgePct}%` : undefined,
    },
    { key: "matchup", label: "Matchup", score: input.rubricScores.matchup },
    { key: "trend", label: "Recent Form", score: input.rubricScores.trend },
    { key: "injury", label: "Injuries", score: input.rubricScores.injury },
    { key: "lineShopping", label: "Line Shopping", score: input.rubricScores.lineShopping },
    { key: "sharpMoney", label: "Sharp Money", score: null, display: "No feed" },
    { key: "lineMovement", label: "Line Movement", score: null, display: "No feed" },
  ];

  const grade = rubric.grade;
  const recommends =
    gradeRank(grade) >= gradeRank(FINAL_AI_MIN_GRADE) &&
    (rubric.edgePct ?? 0) > 0 &&
    (simAligned || highRiskValuePlay);

  return {
    composite: rubric.composite,
    grade,
    confidencePct: rubric.confidencePct,
    edgePct: rubric.edgePct,
    simHit,
    simAligned,
    highRiskValuePlay,
    recommends,
    factors,
    rubric,
  };
}

export function finalAiScoreLabel(score: FinalAiScore | null | undefined): string | null {
  if (!score) return null;
  if (score.highRiskValuePlay) return "High-Risk Value Play";
  if (score.recommends && score.simAligned) return "Sim-Aligned";
  return null;
}

export function gameSimRequiredButMissing(
  pick: ParsedPick,
  gameSim: CoachGameSimEntry | null | undefined,
): boolean {
  return isGameLinePick(pick) && !gameSimHasValidRun(gameSim);
}
