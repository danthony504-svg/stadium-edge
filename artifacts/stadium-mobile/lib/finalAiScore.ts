// Final AI Score — one composite built from simulation + all grounded rubric signals.
// Coach and Simulator share this module so recommendations never diverge.

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  combinePickScore,
  gradeFromComposite,
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
import { pickHasSimGrade } from "./simMarketSupport.ts";
import { impliedProb } from "./format.ts";
import {
  buildPropHolisticScore,
  propHolisticRecommends,
  type PropHolisticContext,
  type PropHolisticScore,
} from "./propHolisticRecommendation.ts";
import type { TeamCoachFactor } from "./teamCoachFactor.ts";

/** Minimum no-vig edge (pct pts) to keep a sim-opposed leg as High-Risk Value Play. */
export const HIGH_RISK_EDGE_MIN = 4.5;

/** Final AI Score factor weights (sum = 1). Renormalized over present factors only. */
export const FINAL_AI_WEIGHTS: Record<string, number> = {
  simulation: 0.3,
  lineValue: 0.2,
  matchup: 0.12,
  teamCoach: 0.08,
  injury: 0.1,
  trend: 0.1,
  sharpMoney: 0.05,
  lineMovement: 0.05,
  lineShopping: 0.05,
};

export const FINAL_AI_MIN_GRADE = "B+";
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
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
  /** Holistic prop score when pick.isProp — all contextual factors blended. */
  propHolistic?: PropHolisticScore | null;
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

/** Weighted 1–10 composite; absent factors are omitted and weights renormalized. */
export function combineFinalAiFactors(factors: FinalAiFactor[]): number | null {
  let wSum = 0;
  let acc = 0;
  for (const f of factors) {
    const w = FINAL_AI_WEIGHTS[f.key];
    if (w == null || f.score == null || !Number.isFinite(f.score)) continue;
    wSum += w;
    acc += w * f.score;
  }
  if (wSum <= 0) return null;
  return round1(acc / wSum);
}

const CONFIDENCE_BASELINE = 50;
const CONFIDENCE_NEUTRAL = 5.5;
const CONFIDENCE_PER_FACTOR = 10;

function confidenceFromFinalAiFactors(factors: FinalAiFactor[]): number | null {
  let present = 0;
  let pts = CONFIDENCE_BASELINE;
  for (const f of factors) {
    if (f.score == null || !Number.isFinite(f.score)) continue;
    present += 1;
    pts += ((f.score - CONFIDENCE_NEUTRAL) / (10 - CONFIDENCE_NEUTRAL)) * CONFIDENCE_PER_FACTOR;
  }
  if (present === 0) return null;
  return clamp(Math.round(pts), 5, 95);
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
  if (simHit == null) return { simAligned: false, highRiskValuePlay: false };
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
  propHolisticContext?: Omit<PropHolisticContext, "rubricScores" | "edgePct" | "simHit">;
  teamCoach?: TeamCoachFactor | null;
}): FinalAiScore {
  const simHit = simHitForPick(input.pick, input.gameSim, input.propSimHit);
  const rubric = combinePickScore(
    input.rubricScores,
    input.edgePct,
    input.odds,
    input.fairProb,
  );

  const { simAligned, highRiskValuePlay } = (() => {
    if (input.pick.isProp && simHit != null && input.odds != null) {
      const implied = impliedProb(input.odds);
      if (Number.isFinite(implied)) {
        return { simAligned: simHit > implied, highRiskValuePlay: false };
      }
    }
    return classifySimAlignment(simHit, rubric.edgePct);
  })();

  const simScore = scoreSimulation(simHit);
  const factors: FinalAiFactor[] = [
    {
      key: "simulation",
      label: "Simulation",
      score: simScore,
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
    {
      key: "teamCoach",
      label: "Team Coach",
      score: input.teamCoach?.score ?? null,
      display: input.teamCoach?.display,
    },
    { key: "trend", label: "Recent Form", score: input.rubricScores.trend },
    { key: "injury", label: "Injuries", score: input.rubricScores.injury },
    { key: "sharpMoney", label: "Sharp Money", score: null, display: "No feed" },
    { key: "lineMovement", label: "Line Movement", score: null, display: "No feed" },
    { key: "lineShopping", label: "Line Shopping", score: input.rubricScores.lineShopping },
  ];

  let propHolistic: PropHolisticScore | null = null;
  if (input.pick.isProp) {
    propHolistic = buildPropHolisticScore({
      ...input.propHolisticContext,
      rubricScores: input.rubricScores,
      edgePct: rubric.edgePct,
      simHit,
    });
    for (const hf of propHolistic.factors) {
      if (!hf.applicable) continue;
      const existing = factors.find((f) => {
        if (hf.key === "recentForm") return f.key === "trend";
        if (hf.key === "sportsbookValue") return f.key === "lineValue";
        if (hf.key === "playingTime") return f.key === "trend";
        return f.key === hf.key;
      });
      if (existing && hf.present && hf.score != null) {
        existing.score = hf.score;
        if (hf.display) existing.display = hf.display;
      }
      if (hf.key === "lineMovement" && hf.present && hf.score != null) {
        const lm = factors.find((f) => f.key === "lineMovement");
        if (lm) {
          lm.score = hf.score;
          lm.display = hf.display;
        }
      }
      if (hf.key === "opponentTendency" && hf.present && hf.score != null) {
        const mu = factors.find((f) => f.key === "matchup");
        if (mu && (input.rubricScores.matchup == null || hf.score > (mu.score ?? 0))) {
          mu.score = hf.score;
          mu.display = hf.display;
          mu.label = "Opponent Tendency";
        }
      }
    }
  }

  const teamCoachScore = input.teamCoach?.score ?? null;
  const propComposite =
    input.pick.isProp && propHolistic?.composite != null
      ? teamCoachScore == null
        ? propHolistic.composite
        : Math.round((propHolistic.composite * 0.85 + teamCoachScore * 0.15) * 10) / 10
      : null;
  const composite = propComposite ?? combineFinalAiFactors(factors);
  const grade = gradeFromComposite(composite);
  const propConfidence =
    input.pick.isProp && propHolistic?.confidencePct != null
      ? teamCoachScore == null
        ? propHolistic.confidencePct
        : Math.round(propHolistic.confidencePct * 0.9 + teamCoachScore * 10 * 0.1)
      : null;
  const confidencePct = propConfidence ?? confidenceFromFinalAiFactors(factors);

  const recommends = input.pick.isProp && propHolistic
    ? propHolisticRecommends(input.pick, propHolistic, {
        edgePct: rubric.edgePct,
        simHit,
        odds: input.odds,
      }) &&
        // A strong Team Coach disagreement needs a documented pricing edge to
        // outweigh it; otherwise the candidate is held before delivery.
        (teamCoachScore == null || teamCoachScore >= 4 || (rubric.edgePct ?? 0) >= 5)
    : gradeRank(grade) >= gradeRank(FINAL_AI_MIN_GRADE) &&
      (rubric.edgePct ?? 0) > 0 &&
      pickHasSimGrade(input.pick, simHit) &&
      (simAligned || highRiskValuePlay);

  if (input.pick.isProp && propHolistic) {
    propHolistic = { ...propHolistic, recommends };
  }

  return {
    composite,
    grade,
    confidencePct,
    edgePct: rubric.edgePct,
    simHit,
    simAligned,
    highRiskValuePlay,
    recommends,
    factors,
    rubric,
    propHolistic,
  };
}

export function finalAiScoreLabel(score: FinalAiScore | null | undefined): string | null {
  if (!score) return null;
  if (score.highRiskValuePlay) return "High-Risk Value Play";
  if (score.recommends && score.simAligned) return "Sim-Aligned";
  return null;
}

export type ConfidenceTier = "Elite" | "High" | "Medium" | "Risky" | "Longshot";

/** Plain conviction tier for cards (replaces Moderate/High Confidence blurbs). */
export function confidenceTierLabel(opts: {
  composite?: number | null;
  confidencePct?: number | null;
  simHit?: number | null;
  odds?: number | null;
  highRiskValuePlay?: boolean;
}): ConfidenceTier {
  const odds = opts.odds ?? 0;
  const simHit = opts.simHit ?? null;
  const composite = opts.composite ?? null;
  const confidencePct = opts.confidencePct ?? null;

  if (odds >= 500 || (odds >= 350 && simHit != null && simHit < 0.38)) return "Longshot";
  if (opts.highRiskValuePlay || (simHit != null && simHit < 0.45 && (composite ?? 0) < 6)) {
    return "Risky";
  }

  const comp = composite ?? 0;
  const conf = confidencePct ?? 50;
  const hit = simHit ?? 0.5;

  if (comp >= 8.2 && hit >= 0.55 && conf >= 72) return "Elite";
  if (comp >= 7.2 && hit >= 0.52 && conf >= 62) return "High";
  if (comp >= 5.5 || conf >= 48 || hit >= 0.5) return "Medium";
  return "Risky";
}

export function gameSimRequiredButMissing(
  pick: ParsedPick,
  gameSim: CoachGameSimEntry | null | undefined,
): boolean {
  return isGameLinePick(pick) && !gameSimHasValidRun(gameSim);
}
