// Game Simulator display helpers — win-prob normalization, weather copy, summary.

import { impliedProb } from "./format.ts";
import type { GameSimulationResult } from "./api.ts";
import type { EvaluatedGameLine } from "./gameLineOptimizer.ts";
import {
  deriveGameSimLineMetrics,
  type GameSimRecommendation,
} from "./gameSimQualityGates.ts";

export type NormalizedWinDisplay = {
  awayPct: number;
  homePct: number;
  tiePct: number;
  favoredSide: "home" | "away" | "even";
};

/** Win bar percentages that sum to 100% among decisive outcomes; tie shown separately. */
export function normalizeGameWinDisplay(result: GameSimulationResult): NormalizedWinDisplay {
  const tie =
    result.tieProbability ??
    Math.max(0, 1 - result.homeWinProbability - result.awayWinProbability);
  const decisive = result.homeWinProbability + result.awayWinProbability;
  const awayPct = decisive > 0 ? result.awayWinProbability / decisive : 0.5;
  const homePct = decisive > 0 ? result.homeWinProbability / decisive : 0.5;

  const homeScore = result.homeProjectedScore ?? 0;
  const awayScore = result.awayProjectedScore ?? 0;
  let favoredSide: NormalizedWinDisplay["favoredSide"] = "even";
  if (awayScore > homeScore + 0.015) favoredSide = "away";
  else if (homeScore > awayScore + 0.015) favoredSide = "home";
  else if (awayPct > homePct + 0.008) favoredSide = "away";
  else if (homePct > awayPct + 0.008) favoredSide = "home";

  return { awayPct, homePct, tiePct: tie, favoredSide };
}

export function weatherSettingLabel(input: {
  climateControlled?: boolean;
  venue?: string | null;
  tempF?: number | null;
  condition?: string | null;
}): string | null {
  if (input.climateControlled) {
    return "Roof: Closed • Weather impact: None";
  }
  const venue = String(input.venue ?? "").toLowerCase();
  if (
    /tropicana|globe life|minute maid|loandepots|rogers centre|chase field|marlins park|t-mobile|american family|roof|dome/i.test(
      venue,
    )
  ) {
    return "Roof: Closed • Weather impact: None";
  }
  if (input.tempF != null && input.condition) {
    return `${input.tempF}°F • ${input.condition}`;
  }
  if (input.tempF != null) return `${input.tempF}°F`;
  return null;
}

export function recommendationSummaryLabel(rec: GameSimRecommendation | null): string {
  if (!rec) return "PASS — No positive expected value found.";
  switch (rec.tier) {
    case "strong":
      return "Strong Bet";
    case "small_edge":
      return "Small Value";
    case "avoid":
      return "Avoid";
    default:
      return "PASS — No positive expected value found.";
  }
}

export type SimulationSummary = {
  bestBet: string | null;
  grade: string | null;
  confidence: number | null;
  edgePct: number | null;
  fairOdds: number | null;
  bookOdds: number | null;
  simHit: number | null;
  breakEven: number | null;
  recommendation: string;
};

export function buildSimulationSummary(
  bestLine: EvaluatedGameLine | null | undefined,
  recommendation: GameSimRecommendation | null,
  leanOnly = false,
): SimulationSummary {
  const metrics = bestLine ? deriveGameSimLineMetrics(bestLine) : null;
  return {
    bestBet: bestLine ? `${bestLine.entry.pick} · ${bestLine.entry.market}` : null,
    grade: metrics ? (leanOnly ? "Lean" : metrics.grade) : null,
    confidence: metrics?.confidencePct ?? null,
    edgePct: metrics?.edgePct ?? null,
    fairOdds: metrics?.fairOdds ?? null,
    bookOdds: metrics?.bookOdds ?? null,
    simHit: metrics?.simHit ?? null,
    breakEven: metrics ? impliedProb(metrics.bookOdds) : null,
    recommendation: recommendation?.label === "Lean" ? "Lean" : recommendationSummaryLabel(recommendation),
  };
}

export function selectRepresentativeReplayScore(result: {
  awayProjectedScore?: number | null;
  homeProjectedScore?: number | null;
  outcomes?: { awayScores: readonly number[]; homeScores: readonly number[] } | null;
}): { away: number; home: number } | null {
  const { awayProjectedScore, homeProjectedScore, outcomes } = result;
  if (!outcomes || awayProjectedScore == null || homeProjectedScore == null ||
      !Number.isFinite(awayProjectedScore) || !Number.isFinite(homeProjectedScore)) return null;
  let closest: { away: number; home: number } | null = null;
  let bestDistance = Infinity;
  const count = Math.min(outcomes.awayScores.length, outcomes.homeScores.length);
  for (let i = 0; i < count; i++) {
    const away = outcomes.awayScores[i]!;
    const home = outcomes.homeScores[i]!;
    if (!Number.isFinite(away) || !Number.isFinite(home) || away < 0 || home < 0) continue;
    const distance = (away - awayProjectedScore) ** 2 + (home - homeProjectedScore) ** 2;
    if (distance < bestDistance) {
      closest = { away, home };
      bestDistance = distance;
    }
  }
  return closest;
}
