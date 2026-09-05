import type { FantasyNflGameLog } from "@/lib/api";
import { fantasyPoints, type FantasyScoringFormat, type FantasyStatLine } from "@/lib/fantasyScoring";

export type HistoricalFantasyAnalysis = {
  recentAverage: number | null;
  floor: number | null;
  ceiling: number | null;
  games: number;
};

function numberFor(stats: Record<string, string> | undefined, aliases: string[]): number | null {
  if (!stats) return null;
  const found = Object.entries(stats).find(([label]) =>
    aliases.includes(label.trim().toLowerCase().replace(/[^a-z]/g, "")),
  )?.[1];
  const value = Number(found);
  return Number.isFinite(value) ? value : null;
}

function category(game: FantasyNflGameLog, name: string): Record<string, string> | undefined {
  return Object.entries(game.categories).find(([key]) => key.replace(/[^a-z]/g, "").includes(name))?.[1];
}

/** Converts category-preserving, recorded ESPN box-score rows—not betting sims—into FP. */
export function fantasyPointsFromRecordedNflGame(
  game: FantasyNflGameLog,
  format: FantasyScoringFormat,
): number | null {
  const pass = category(game, "passing");
  const rush = category(game, "rushing");
  const receive = category(game, "receiving");
  const fumbles = category(game, "fumble");
  if (!pass && !rush && !receive) return null;
  const stat: FantasyStatLine = {
    passingYards: numberFor(pass, ["yds", "yards"]) ?? undefined,
    passingTouchdowns: numberFor(pass, ["td", "touchdowns"]) ?? undefined,
    interceptions: numberFor(pass, ["int", "interceptions"]) ?? undefined,
    rushingYards: numberFor(rush, ["yds", "yards"]) ?? undefined,
    rushingTouchdowns: numberFor(rush, ["td", "touchdowns"]) ?? undefined,
    receivingYards: numberFor(receive, ["yds", "yards"]) ?? undefined,
    receivingTouchdowns: numberFor(receive, ["td", "touchdowns"]) ?? undefined,
    receptions: numberFor(receive, ["rec", "receptions"]) ?? undefined,
    fumblesLost: numberFor(fumbles, ["lost", "fl"]) ?? undefined,
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
  if (!values.length) return { recentAverage: null, floor: null, ceiling: null, games: 0 };
  return {
    recentAverage: values.reduce((sum, value) => sum + value, 0) / values.length,
    floor: Math.min(...values),
    ceiling: Math.max(...values),
    games: values.length,
  };
}
