import type { FantasyNflGameLog } from "@/lib/api";
import { fantasyPoints, type FantasyScoringFormat, type FantasyStatLine } from "@/lib/fantasyScoring";

export type HistoricalFantasyAnalysis = {
  recentAverage: number | null;
  floor: number | null;
  ceiling: number | null;
  targetsPerGame: number | null;
  carriesPerGame: number | null;
  touchesPerGame: number | null;
  games: number;
  sourceInputs: {
    provider: "ESPN athlete gamelog";
    eventIds: string[];
    scoringFormat: FantasyScoringFormat;
  };
};

function numberFor(stats: Record<string, string>, name: string): number | null {
  const found = stats[name];
  const value = Number(found);
  return Number.isFinite(value) ? value : null;
}

/** Converts category-preserving, recorded ESPN box-score rows—not betting sims—into FP. */
export function fantasyPointsFromRecordedNflGame(
  game: FantasyNflGameLog,
  format: FantasyScoringFormat,
): number | null {
  const stats = game.stats;
  if (!Object.keys(stats).length) return null;
  const stat: FantasyStatLine = {
    passingYards: numberFor(stats, "passingYards") ?? undefined,
    passingTouchdowns: numberFor(stats, "passingTouchdowns") ?? undefined,
    interceptions: numberFor(stats, "interceptions") ?? undefined,
    rushingYards: numberFor(stats, "rushingYards") ?? undefined,
    rushingTouchdowns: numberFor(stats, "rushingTouchdowns") ?? undefined,
    receivingYards: numberFor(stats, "receivingYards") ?? undefined,
    receivingTouchdowns: numberFor(stats, "receivingTouchdowns") ?? undefined,
    receptions: numberFor(stats, "receptions") ?? undefined,
    fumblesLost: numberFor(stats, "fumblesLost") ?? undefined,
  };
  return fantasyPoints(stat, format);
}

export function historicalFantasyAnalysis(
  games: FantasyNflGameLog[],
  format: FantasyScoringFormat,
): HistoricalFantasyAnalysis {
  const values = games.slice(0, 10)
    .map((game) => fantasyPointsFromRecordedNflGame(game, format))
    .filter((value): value is number => value != null);
  const usageAverage = (name: string) => {
    const values = games.slice(0, 10).map((game) => numberFor(game.stats, name)).filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const sources = { provider: "ESPN athlete gamelog" as const, eventIds: games.slice(0, 10).map((game) => game.eventId), scoringFormat: format };
  if (!values.length) return { recentAverage: null, floor: null, ceiling: null, targetsPerGame: usageAverage("receivingTargets"), carriesPerGame: usageAverage("rushingAttempts"), touchesPerGame: null, games: 0, sourceInputs: sources };
  const carries = usageAverage("rushingAttempts");
  const receptions = usageAverage("receptions");
  return {
    recentAverage: values.reduce((sum, value) => sum + value, 0) / values.length,
    floor: Math.min(...values),
    ceiling: Math.max(...values),
    targetsPerGame: usageAverage("receivingTargets"),
    carriesPerGame: carries,
    touchesPerGame: carries != null && receptions != null ? carries + receptions : null,
    games: values.length,
    sourceInputs: sources,
  };
}
