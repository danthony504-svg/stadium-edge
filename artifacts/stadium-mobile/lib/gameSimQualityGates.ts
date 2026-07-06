// Shared Game Simulator quality gates — Best Lines, recommendation tiers, Coach filter.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import { americanToDecimal, decimalToAmerican, impliedProb } from "./format.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import type { EvaluatedGameLine } from "./gameLineOptimizer.ts";
import {
  gameSimHasValidRun,
  gameSimHitForPick,
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
export type EvaluatedLineMetrics = {
  winProb: number | null;
  edgePct: number | null;
  finalAiScore: {
    grade: string | null;
    confidencePct: number | null;
    simHit: number | null;
    edgePct: number | null;
  };
};

export type GameRecsForRecommendation = {
  overall: EvaluatedLineMetrics | null;
  byTeam: { away: EvaluatedLineMetrics | null; home: EvaluatedLineMetrics | null };
};

export const TIGHT_MARGIN_RUNS = 0.5;
export const STANDARD_SPREAD_MAX = 1.5;
export const COACH_SIM_MIN_CONFIDENCE = 52;
export const COACH_SIM_MIN_GRADE = "C+";

const GRADE_RANK: Record<string, number> = {
  F: 0, D: 1, "C-": 2, C: 3, "C+": 4, "B-": 5, B: 6, "B+": 7, "A-": 8, A: 9, "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

export type GameSimLineMetrics = {
  simHit: number;
  fairOdds: number;
  bookOdds: number;
  evPct: number;
  edgePct: number;
  grade: string;
  confidencePct: number;
};

/** EV% from sim hit probability vs posted American odds. */
export function simEvPct(simHit: number, americanOdds: number): number | null {
  if (!Number.isFinite(simHit) || !Number.isFinite(americanOdds)) return null;
  const ev = simHit * americanToDecimal(americanOdds) - 1;
  if (!Number.isFinite(ev)) return null;
  return Math.round(ev * 1000) / 10;
}

/** Edge in pct points: sim hit minus book implied probability. */
export function simEdgeFromHit(simHit: number, americanOdds: number): number | null {
  const implied = impliedProb(americanOdds);
  if (!Number.isFinite(simHit) || !Number.isFinite(implied)) return null;
  return Math.round((simHit - implied) * 1000) / 10;
}

/**
 * Derive every Best Lines metric from the 10k sim + posted book price.
 * Returns null when any required value cannot be grounded.
 */
export function deriveGameSimLineMetrics(row: EvaluatedGameLine): GameSimLineMetrics | null {
  const simHit = row.winProb ?? row.finalAiScore.simHit;
  const bookOdds = row.entry.odds;
  const grade = row.finalAiScore.grade;
  const confidencePct = row.finalAiScore.confidencePct;

  if (simHit == null || !Number.isFinite(simHit) || simHit <= 0 || simHit >= 1) return null;
  if (bookOdds == null || !Number.isFinite(bookOdds) || bookOdds === 0) return null;
  if (!grade) return null;
  if (confidencePct == null || !Number.isFinite(confidencePct)) return null;

  const fairOdds = fairOddsFromProb(simHit);
  const evPct = simEvPct(simHit, bookOdds);
  const edgePct =
    row.edgePct ?? row.finalAiScore.edgePct ?? simEdgeFromHit(simHit, bookOdds);

  if (
    fairOdds == null ||
    !Number.isFinite(fairOdds) ||
    fairOdds === 0 ||
    evPct == null ||
    edgePct == null ||
    !Number.isFinite(edgePct)
  ) {
    return null;
  }

  return { simHit, fairOdds, bookOdds, evPct, edgePct, grade, confidencePct };
}

/** Every Best Lines metric is present — never show "—" placeholders. */
export function hasCompleteEvaluatedLine(row: EvaluatedLineMetrics | EvaluatedGameLine): boolean {
  if ("entry" in row) {
    return deriveGameSimLineMetrics(row) != null;
  }
  const hit = row.winProb ?? row.finalAiScore.simHit;
  const edge = row.edgePct ?? row.finalAiScore.edgePct;
  return (
    hit != null &&
    Number.isFinite(hit) &&
    edge != null &&
    Number.isFinite(edge) &&
    row.finalAiScore.grade != null &&
    row.finalAiScore.confidencePct != null &&
    Number.isFinite(row.finalAiScore.confidencePct)
  );
}

/** Best Lines surface only complete lines with sim-confirmed positive edge. */
export function qualifiesForBestLines(row: EvaluatedGameLine): boolean {
  const m = deriveGameSimLineMetrics(row);
  return m != null && m.edgePct > 0;
}

export const NO_POSITIVE_EDGE_MESSAGE = "No positive betting edge found";

export function projectedScoreMargin(sim: CoachGameSimEntry): number {
  const home = sim.homeProjectedScore;
  const away = sim.awayProjectedScore;
  if (home == null || away == null || !Number.isFinite(home) || !Number.isFinite(away)) {
    return 0;
  }
  return Math.abs(home - away);
}

export function spreadPointsFromPick(pick: string): number | null {
  const m = String(pick ?? "").match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Alt spreads beyond ±1.5 (e.g. +2.5, -3.5). */
export function isAggressiveAltSpread(market: string, pick: string): boolean {
  const m = String(market ?? "").trim().toLowerCase();
  if (m !== "alt spread" && m !== "spread") return false;
  const pts = spreadPointsFromPick(pick);
  if (pts == null) return false;
  return Math.abs(pts) > STANDARD_SPREAD_MAX;
}

/**
 * Coin-flip projections: only ML, ±1.5 spreads, and totals — no aggressive alt spreads.
 */
export function filterEvalLinesForProjectedMargin(
  lines: RealOddsEntry[],
  sim: CoachGameSimEntry,
): RealOddsEntry[] {
  if (projectedScoreMargin(sim) >= TIGHT_MARGIN_RUNS) return lines;
  return lines.filter((e) => {
    const m = e.market.trim().toLowerCase();
    if (m === "moneyline" || m === "total" || m === "alt total" || /team total/i.test(m)) {
      return true;
    }
    if (m === "spread" || m === "alt spread") {
      const pts = spreadPointsFromPick(e.pick);
      if (pts == null) return false;
      return Math.abs(pts) <= STANDARD_SPREAD_MAX;
    }
    return true;
  });
}

export type GameSimRecommendationTier =
  | "strong"
  | "good_edge"
  | "small_edge"
  | "pass"
  | "avoid";

export type GameSimRecommendation = {
  tier: GameSimRecommendationTier;
  emoji: string;
  label: string;
  detail: string;
  /** Favored team when a side is recommended; null when no edge. */
  favoredTeam: string | null;
  /** Win probability (0–1) for the favored side. */
  favoredWinProb: number | null;
};

/** Minimum sim win probability before recommending a side. */
export const WIN_PROB_MIN_EDGE = 0.55;
export const WIN_PROB_SMALL_EDGE_MAX = 0.6;
export const WIN_PROB_GOOD_EDGE_MAX = 0.65;

export type WinProbEdgeBand = "no_edge" | "small_edge" | "good_edge" | "strong_edge";

export function winProbEdgeBand(winProb: number): WinProbEdgeBand {
  if (!Number.isFinite(winProb) || winProb < WIN_PROB_MIN_EDGE) return "no_edge";
  if (winProb < WIN_PROB_SMALL_EDGE_MAX) return "small_edge";
  if (winProb < WIN_PROB_GOOD_EDGE_MAX) return "good_edge";
  return "strong_edge";
}

function pct1(n: number): number {
  return Math.round(n * 1000) / 10;
}

/**
 * Overall simulator recommendation from 10k-run win probability.
 * Under 55% → no side; 55–60% Small; 60–65% Good; 65%+ Strong.
 */
export function classifyGameSimRecommendation(
  sim: CoachGameSimEntry,
  homeTeam: string,
  awayTeam: string,
): GameSimRecommendation {
  const homeWin = sim.homeWinProbability ?? 0.5;
  const awayWin = sim.awayWinProbability ?? 0.5;
  const homeFavored = homeWin >= awayWin;
  const favoredWin = homeFavored ? homeWin : awayWin;
  const favoredTeam = homeFavored ? homeTeam : awayTeam;
  const underdogTeam = homeFavored ? awayTeam : homeTeam;
  const underdogWin = homeFavored ? awayWin : homeWin;
  const band = winProbEdgeBand(favoredWin);

  if (band === "no_edge") {
    return {
      tier: "pass",
      emoji: "⚪",
      label: "No Betting Edge",
      detail: `Neither side clears 55% win probability (${underdogTeam} ${pct1(underdogWin)}%, ${favoredTeam} ${pct1(favoredWin)}%).`,
      favoredTeam: null,
      favoredWinProb: null,
    };
  }

  const favoredPct = pct1(favoredWin);
  if (band === "small_edge") {
    return {
      tier: "small_edge",
      emoji: "🟡",
      label: "Small Edge",
      detail: `${favoredTeam} ${favoredPct}% win probability (55–60% band).`,
      favoredTeam,
      favoredWinProb: favoredWin,
    };
  }
  if (band === "good_edge") {
    return {
      tier: "good_edge",
      emoji: "🟢",
      label: "Good Edge",
      detail: `${favoredTeam} ${favoredPct}% win probability (60–65% band).`,
      favoredTeam,
      favoredWinProb: favoredWin,
    };
  }
  return {
    tier: "strong",
    emoji: "🟢",
    label: "Strong Edge",
    detail: `${favoredTeam} ${favoredPct}% win probability (65%+ band).`,
    favoredTeam,
    favoredWinProb: favoredWin,
  };
}

/** AI Coach game-line legs must pass every simulator quality check. */
export function passesCoachSimQualityGate(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  opts: {
    edge?: number | null;
    finalAi?: FinalAiScore | null;
    odds?: number | null;
  } = {},
): boolean {
  if (!isGameLinePick(pick)) return true;
  if (!gameSimHasValidRun(sim)) return false;

  const finalAi = opts.finalAi ?? pick.finalAiScore ?? null;
  const hit = finalAi?.simHit ?? gameSimHitForPick(pick, sim);
  const edge = finalAi?.edgePct ?? opts.edge ?? pick.scores?.edgePct ?? null;
  const grade = finalAi?.grade ?? null;
  const conf = finalAi?.confidencePct ?? null;
  const odds = opts.odds ?? pick.odds ?? null;

  if (hit == null || edge == null || grade == null || conf == null) return false;
  if (edge <= 0) return false;
  if (gradeRank(grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (conf < COACH_SIM_MIN_CONFIDENCE) return false;

  if (odds != null && Number.isFinite(odds)) {
    const implied = impliedProb(odds);
    if (hit <= implied) return false;
  }

  return true;
}

export function fairOddsFromProb(prob: number | null | undefined): number | null {
  if (prob == null || !Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
  return decimalToAmerican(1 / prob);
}
