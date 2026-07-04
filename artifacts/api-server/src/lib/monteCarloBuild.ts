import { computeAmbiguous, gameValueForMarket, isDiscreteCountMarket } from "./propStatValue.js";
import {
  type PropSimulationContext,
  type PropSimulationResult,
  type PropSimSide,
  runMonteCarloSimulation,
  simulationKey,
} from "./monteCarlo.js";

export type SimPropRequest = {
  player: string;
  market: string;
  line: number;
  side: PropSimSide;
  athleteId?: string | null;
  sport: string;
  isHome?: boolean | null;
  opponentTeamId?: string | null;
};

export type PlayerHistoryShape = {
  labels: string[];
  recent: Array<{ stats: Record<string, string>; isHome?: boolean | null; opponentId?: string | null }>;
  vsOpponent: Array<{ stats: Record<string, string> }>;
  homeSplit?: { games: number; averages: Record<string, number> };
  awaySplit?: { games: number; averages: Record<string, number> };
  minutesTrend?: {
    l5: number | null;
    l10: number | null;
    season: number | null;
    direction: "up" | "down" | "steady";
  } | null;
  windows?: {
    last5?: { averages: Record<string, number> };
    last10?: { averages: Record<string, number> };
  };
};

export type GameSimContext = {
  sport: string;
  oppPace?: number | null;
  leaguePace?: number | null;
  oppKeyInjuries?: number;
  ownKeyInjuries?: number;
  weatherImpact?: number | null;
  playerHistories: Map<string, PlayerHistoryShape>;
};

function statSeries(
  market: string,
  games: Array<{ stats: Record<string, string> }>,
  labels: string[],
): number[] {
  const ambiguous = computeAmbiguous(labels);
  const out: number[] = [];
  for (const g of games) {
    const v = gameValueForMarket(market, g.stats, ambiguous);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function keyInjuryWeight(entries: Array<{ status?: string }> | undefined): number {
  if (!entries?.length) return 0;
  let w = 0;
  for (const e of entries) {
    const s = String(e.status ?? "").toLowerCase();
    if (s.includes("out") || s.includes("doubtful")) w += 2;
    else if (s.includes("questionable") || s.includes("day")) w += 1;
  }
  return w;
}

export function buildPropSimulationContext(
  req: SimPropRequest,
  history: PlayerHistoryShape | null | undefined,
  game: GameSimContext,
): PropSimulationContext | null {
  if (!history?.recent?.length) return null;
  const labels = history.labels ?? [];
  const recentValues = statSeries(req.market, history.recent, labels);
  if (recentValues.length < 3) return null;

  const vsOpponentValues = statSeries(req.market, history.vsOpponent ?? [], labels);
  const homeGames = history.recent.filter((g) => g.isHome === true);
  const awayGames = history.recent.filter((g) => g.isHome === false);

  return {
    sport: req.sport,
    market: req.market,
    line: req.line,
    side: req.side,
    recentValues,
    vsOpponentValues,
    homeValues: statSeries(req.market, homeGames, labels),
    awayValues: statSeries(req.market, awayGames, labels),
    isHome: req.isHome ?? null,
    minutesL5: history.minutesTrend?.l5 ?? null,
    minutesSeason: history.minutesTrend?.season ?? null,
    minutesDirection: history.minutesTrend?.direction,
    oppPace: game.oppPace ?? null,
    leaguePace: game.leaguePace ?? null,
    oppKeyInjuries: game.oppKeyInjuries ?? 0,
    ownKeyInjuries: game.ownKeyInjuries ?? 0,
    weatherImpact: game.weatherImpact ?? null,
    discrete: isDiscreteCountMarket(req.market),
  };
}

export function simulateProp(
  req: SimPropRequest,
  history: PlayerHistoryShape | null | undefined,
  game: GameSimContext,
  simulations?: number,
): PropSimulationResult & { key: string; player: string; market: string; line: number; side: PropSimSide } {
  const key = simulationKey(req.player, req.market, req.line, req.side);
  const ctx = buildPropSimulationContext(req, history, game);
  if (!ctx) {
    return {
      key,
      player: req.player,
      market: req.market,
      line: req.line,
      side: req.side,
      simulations: 0,
      hitProbability: null,
      mostLikelyLine: null,
      meanProjection: null,
      medianProjection: null,
      confidenceScore: null,
      stdDev: null,
      sampleGames: history?.recent?.length ?? 0,
      percentiles: null,
    };
  }
  const result = runMonteCarloSimulation(ctx, simulations);
  return { key, player: req.player, market: req.market, line: req.line, side: req.side, ...result };
}

export { keyInjuryWeight };
