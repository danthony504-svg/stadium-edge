import { computeAmbiguous, gameValueForMarket, isDiscreteCountMarket } from "./propStatValue.js";
import {
  type PropSimulationContext,
  type PropSimulationResult,
  type PropSimSide,
  type RunMonteCarloOpts,
  runMonteCarloSimulation,
  scoreSharedDistribution,
  simulationKey,
} from "./monteCarlo.js";
import {
  propSharedDistributionKey,
  type PropSharedDistributionParts,
} from "./propSharedDistribution.js";

export type PropSimNullReason =
  | "missing_athlete_id"
  | "no_history"
  | "insufficient_sample"
  | "stat_mapping_failed";

export type SimPropRequest = {
  player: string;
  market: string;
  line: number;
  side: PropSimSide;
  athleteId?: string | null;
  sport: string;
  isHome?: boolean | null;
  opponentTeamId?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  /** Extra alt rungs scored on the same 10k draw as `line`. */
  additionalLines?: number[];
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
  playerHistories?: Map<string, PlayerHistoryShape>;
};

/** Minimal game/context fields required to decide distribution sharing. */
export type SharedDistGameContext = {
  sport: string;
  oppPace?: number | null;
  leaguePace?: number | null;
  oppKeyInjuries?: number;
  ownKeyInjuries?: number;
  weatherImpact?: number | null;
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

export function diagnosePropSimNullReason(
  req: SimPropRequest,
  history: PlayerHistoryShape | null | undefined,
): PropSimNullReason {
  if (!req.athleteId) return "missing_athlete_id";
  if (!history?.recent?.length) return "no_history";
  const labels = history.labels ?? [];
  const recentValues = statSeries(req.market, history.recent, labels);
  if (recentValues.length === 0) return "stat_mapping_failed";
  if (recentValues.length < 3) return "insufficient_sample";
  return "insufficient_sample";
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
    additionalLines: req.additionalLines,
  };
}

export type SimPropRow = PropSimulationResult & {
  key: string;
  player: string;
  market: string;
  line: number;
  side: PropSimSide;
  nullReason?: PropSimNullReason | null;
};

function nullSimPropRow(
  req: SimPropRequest,
  history: PlayerHistoryShape | null | undefined,
): SimPropRow {
  return {
    key: simulationKey(req.player, req.market, req.line, req.side),
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
    nullReason: diagnosePropSimNullReason(req, history),
  };
}

export function simulateProp(
  req: SimPropRequest,
  history: PlayerHistoryShape | null | undefined,
  game: GameSimContext,
  simulations?: number,
  opts?: RunMonteCarloOpts,
): SimPropRow {
  const key = simulationKey(req.player, req.market, req.line, req.side);
  const ctx = buildPropSimulationContext(req, history, game);
  if (!ctx) return nullSimPropRow(req, history);
  const result = runMonteCarloSimulation(ctx, simulations, opts);
  return { key, player: req.player, market: req.market, line: req.line, side: req.side, ...result };
}

/** Parts used to decide whether two prop requests may share one Monte Carlo draw. */
export function sharedDistributionPartsForProp(
  req: SimPropRequest,
  game: SharedDistGameContext,
  isHome: boolean | null,
): PropSharedDistributionParts {
  return {
    sport: String(req.sport ?? game.sport ?? "").toLowerCase(),
    player: req.player,
    market: req.market,
    athleteId: req.athleteId,
    opponentTeamId: req.opponentTeamId,
    isHome,
    homeTeamId: req.homeTeamId,
    awayTeamId: req.awayTeamId,
    oppPace: game.oppPace ?? null,
    leaguePace: game.leaguePace ?? null,
    oppKeyInjuries: game.oppKeyInjuries ?? 0,
    ownKeyInjuries: game.ownKeyInjuries ?? 0,
    weatherImpact: game.weatherImpact ?? null,
  };
}

export function propRequestSharedDistributionKey(
  req: SimPropRequest,
  game: SharedDistGameContext,
  isHome: boolean | null,
): string {
  return propSharedDistributionKey(sharedDistributionPartsForProp(req, game, isHome));
}

/**
 * One underlying draw for a compatible group; expand to one row per request.
 * Preserves each request's market string (incl. `_alternate`) and exact line/side.
 */
export function simulatePropGroupShared(
  requests: SimPropRequest[],
  history: PlayerHistoryShape | null | undefined,
  game: GameSimContext,
  simulations?: number,
  opts?: { seed?: number },
): SimPropRow[] {
  if (!requests.length) return [];
  const primary = requests[0]!;
  const ctx = buildPropSimulationContext(primary, history, game);
  if (!ctx) {
    return requests.map((req) => nullSimPropRow(req, history));
  }

  const allLines = [
    ...new Set(
      requests
        .flatMap((r) => [r.line, ...(r.additionalLines ?? [])])
        .filter((l) => Number.isFinite(l)),
    ),
  ].sort((a, b) => a - b);

  const targets = requests.map((r) => ({ line: r.line, side: r.side }));
  const bundle = scoreSharedDistribution(ctx, targets, simulations, {
    seed: opts?.seed,
    evaluateLines: allLines,
  });

  return requests.map((req, i) => {
    const hit = bundle.results[i]!;
    const lineHitRates: Record<string, number> = {};
    const extras = (req.additionalLines ?? []).filter((l) => l !== req.line);
    const sideMap =
      req.side === "Under"
        ? bundle.lineHitRatesBySide?.Under
        : bundle.lineHitRatesBySide?.Over;
    for (const ln of extras) {
      const v = sideMap?.[String(ln)];
      if (v != null) lineHitRates[String(ln)] = v;
    }
    return {
      key: simulationKey(req.player, req.market, req.line, req.side),
      player: req.player,
      market: req.market,
      line: req.line,
      side: req.side,
      simulations: hit.simulations,
      hitProbability: hit.hitProbability,
      mostLikelyLine: hit.mostLikelyLine,
      meanProjection: hit.meanProjection,
      medianProjection: hit.medianProjection,
      confidenceScore: hit.confidenceScore,
      stdDev: hit.stdDev,
      sampleGames: hit.sampleGames,
      percentiles: hit.percentiles,
      ...(Object.keys(lineHitRates).length ? { lineHitRates } : {}),
      ...(bundle.lineHitRatesBySide
        ? { lineHitRatesBySide: bundle.lineHitRatesBySide }
        : {}),
      nullReason: hit.hitProbability == null ? diagnosePropSimNullReason(req, history) : null,
    };
  });
}

export { keyInjuryWeight };
