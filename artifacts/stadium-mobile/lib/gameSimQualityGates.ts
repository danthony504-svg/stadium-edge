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

/** Full AI Coach quality gate — positive EV/edge, grade ≥ C+, conf ≥ 52%, sim above implied. */
export function qualifiesCoachSimLineMetrics(m: GameSimLineMetrics): boolean {
  if (m.evPct <= 0) return false;
  if (m.edgePct <= 0) return false;
  if (m.confidencePct < COACH_SIM_MIN_CONFIDENCE) return false;
  if (gradeRank(m.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  const implied = impliedProb(m.bookOdds);
  if (m.simHit <= implied) return false;
  return true;
}

export function qualifiesCoachSimEvalLine(row: EvaluatedGameLine): boolean {
  const m = deriveGameSimLineMetrics(row);
  return m != null && qualifiesCoachSimLineMetrics(m);
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

export type GameSimRecommendationTier = "strong" | "small_edge" | "pass" | "avoid";

export type GameSimRecommendation = {
  tier: GameSimRecommendationTier;
  emoji: string;
  label: string;
  detail: string;
};

function bestCompleteLine(recs: GameRecsForRecommendation): EvaluatedLineMetrics | null {
  const pool = [recs.overall, recs.byTeam.away, recs.byTeam.home].filter(
    (r): r is EvaluatedLineMetrics => r != null && hasCompleteEvaluatedLine(r),
  );
  if (!pool.length) return null;
  return pool.sort((a, b) => (b.edgePct ?? -999) - (a.edgePct ?? -999))[0]!;
}

/** Overall simulator recommendation for the game card. */
export function classifyGameSimRecommendation(
  recs: GameRecsForRecommendation | null,
  sim: CoachGameSimEntry,
): GameSimRecommendation {
  const margin = projectedScoreMargin(sim);
  const homeWin = sim.homeWinProbability ?? 0.5;
  const awayWin = sim.awayWinProbability ?? 0.5;
  const coinFlip =
    margin < TIGHT_MARGIN_RUNS &&
    Math.abs(homeWin - 0.5) < 0.03 &&
    Math.abs(awayWin - 0.5) < 0.03;

  if (!recs) {
    return {
      tier: "pass",
      emoji: "⚪",
      label: "Pass (No Edge)",
      detail: NO_POSITIVE_EDGE_MESSAGE,
    };
  }

  const best = bestCompleteLine(recs);
  if (!best) {
    return {
      tier: "pass",
      emoji: "⚪",
      label: "Pass (No Edge)",
      detail: NO_POSITIVE_EDGE_MESSAGE,
    };
  }

  const edge = best.edgePct ?? 0;
  const grade = best.finalAiScore.grade;
  const conf = best.finalAiScore.confidencePct ?? 0;
  const simHit = best.winProb ?? 0;

  if (coinFlip && edge < 1) {
    return {
      tier: "pass",
      emoji: "⚪",
      label: "Pass (No Edge)",
      detail: "No betting edge found — projected margin under 0.5 runs with ~50/50 win rates.",
    };
  }

  if (edge < 0) {
    return {
      tier: "avoid",
      emoji: "🔴",
      label: "Avoid",
      detail: `Best complete line shows ${edge}% edge against the 10,000-run sim.`,
    };
  }

  if (
    edge >= 2 &&
    gradeRank(grade) >= gradeRank("B") &&
    conf >= 58 &&
    simHit >= 0.54
  ) {
    return {
      tier: "strong",
      emoji: "🟢",
      label: "Strong Bet",
      detail: `+${edge}% edge, Final AI ${grade}, ${conf} confidence, ${Math.round(simHit * 100)}% sim hit.`,
    };
  }

  if (edge > 0 && gradeRank(grade) >= gradeRank(COACH_SIM_MIN_GRADE) && conf >= COACH_SIM_MIN_CONFIDENCE) {
    return {
      tier: "small_edge",
      emoji: "🟡",
      label: "Small Edge",
      detail: `+${edge}% edge, Final AI ${grade}, ${conf} confidence.`,
    };
  }

  return {
    tier: "pass",
    emoji: "⚪",
    label: "Pass (No Edge)",
    detail: "No line clears Final AI C+ with positive edge and complete sim data.",
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
