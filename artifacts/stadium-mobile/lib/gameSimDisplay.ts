// Game Simulator display helpers — win-prob normalization, weather copy, summary.

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
  recommendation: string;
};

export function buildSimulationSummary(
  bestLine: EvaluatedGameLine | null | undefined,
  recommendation: GameSimRecommendation | null,
): SimulationSummary {
  const metrics = bestLine ? deriveGameSimLineMetrics(bestLine) : null;
  return {
    bestBet: bestLine?.entry.pick ?? null,
    grade: metrics?.grade ?? null,
    confidence: metrics?.confidencePct ?? null,
    edgePct: metrics?.edgePct ?? null,
    fairOdds: metrics?.fairOdds ?? null,
    bookOdds: metrics?.bookOdds ?? null,
    recommendation: recommendationSummaryLabel(recommendation),
  };
}
