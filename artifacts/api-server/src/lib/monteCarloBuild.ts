import { computeAmbiguous, gameValueForMarket, isDiscreteCountMarket } from "./propStatValue.js";
import {
  type PropSimulationContext,
  type PropSimulationResult,
  type PropSimSide,
  type RunMonteCarloOpts,
  type SharedDrawScoreBundle,
  runMonteCarloSimulation,
  scoreSharedDistribution,
  scoreTargetsFromSamples,
  simulationKey,
} from "./monteCarlo.js";
import {
  propSharedDistributionKey,
  type PropSharedDistributionParts,
} from "./propSharedDistribution.js";
import type { CachedPropDistribution } from "./propDistributionCache.js";
import type { SimTier } from "./simCache.js";

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

/** Expand one shared-draw bundle into per-request rows (provider line/side preserved). */
export function expandSimPropRowsFromBundle(
  requests: SimPropRequest[],
  history: PlayerHistoryShape | null | undefined,
  bundle: SharedDrawScoreBundle,
): SimPropRow[] {
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

/** Persistable 10k draw — line/side/odds free. */
export function cachedPropDistributionFromBundle(
  distributionKey: string,
  tier: SimTier,
  ctx: PropSimulationContext,
  bundle: SharedDrawScoreBundle,
): CachedPropDistribution | null {
  if (!bundle.samples?.length || !bundle.shared) return null;
  const shared = bundle.shared;
  if (
    shared.meanProjection == null ||
    shared.medianProjection == null ||
    shared.stdDev == null ||
    !shared.percentiles
  ) {
    return null;
  }
  return {
    distributionKey,
    tier,
    simulations: shared.simulations,
    samples: bundle.samples,
    meanProjection: shared.meanProjection,
    medianProjection: shared.medianProjection,
    mostLikelyLine: shared.mostLikelyLine,
    stdDev: shared.stdDev,
    sampleGames: shared.sampleGames,
    percentiles: shared.percentiles,
    vsOpponentCount: (ctx.vsOpponentValues ?? []).filter((v) => Number.isFinite(v)).length,
    minutesL5: ctx.minutesL5 ?? null,
    minutesSeason: ctx.minutesSeason ?? null,
    oppPace: ctx.oppPace ?? null,
  };
}

/** Score provider thresholds against a cached draw (no new Monte Carlo). */
export function scoreRequestsFromCachedDistribution(
  requests: SimPropRequest[],
  history: PlayerHistoryShape | null | undefined,
  ctx: PropSimulationContext,
  cached: CachedPropDistribution,
  evaluateLines?: number[],
): SimPropRow[] {
  const targets = requests.map((r) => ({ line: r.line, side: r.side }));
  const bundle = scoreTargetsFromSamples(
    cached.samples,
    {
      simulations: cached.simulations,
      mostLikelyLine: cached.mostLikelyLine,
      meanProjection: cached.meanProjection,
      medianProjection: cached.medianProjection,
      stdDev: cached.stdDev,
      sampleGames: cached.sampleGames,
      percentiles: cached.percentiles,
    },
    targets,
    ctx,
    evaluateLines,
  );
  return expandSimPropRowsFromBundle(requests, history, bundle);
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

  return expandSimPropRowsFromBundle(requests, history, bundle);
}

/**
 * Draw once from a pre-built context (Phase 2.1 propsim-ctx hit path).
 * Same statistical model as simulatePropGroupSharedWithDistribution.
 */
export function simulatePropGroupFromContext(
  requests: SimPropRequest[],
  ctx: PropSimulationContext,
  history: PlayerHistoryShape | null | undefined,
  distributionKey: string,
  tier: SimTier,
  simulations?: number,
  opts?: { seed?: number },
): { rows: SimPropRow[]; distribution: CachedPropDistribution | null } {
  if (!requests.length) return { rows: [], distribution: null };

  const allLines = [
    ...new Set(
      requests
        .flatMap((r) => [r.line, ...(r.additionalLines ?? [])])
        .filter((l) => Number.isFinite(l)),
    ),
  ].sort((a, b) => a - b);

  const targets = requests.map((r) => ({ line: r.line, side: r.side }));
  // Apply primary request line/side onto ctx for the shared draw base.
  const primary = requests[0]!;
  const drawCtx: PropSimulationContext = {
    ...ctx,
    line: primary.line,
    side: primary.side,
    additionalLines: primary.additionalLines,
  };
  const bundle = scoreSharedDistribution(drawCtx, targets, simulations, {
    seed: opts?.seed,
    evaluateLines: allLines,
  });
  return {
    rows: expandSimPropRowsFromBundle(requests, history, bundle),
    distribution: cachedPropDistributionFromBundle(distributionKey, tier, drawCtx, bundle),
  };
}

/**
 * Draw once (or reuse) and return both rows + cacheable distribution payload.
 * Used by the simulate route so alt lines share one 10k draw across requests.
 */
export function simulatePropGroupSharedWithDistribution(
  requests: SimPropRequest[],
  history: PlayerHistoryShape | null | undefined,
  game: GameSimContext,
  distributionKey: string,
  tier: SimTier,
  simulations?: number,
  opts?: { seed?: number },
): { rows: SimPropRow[]; distribution: CachedPropDistribution | null } {
  if (!requests.length) return { rows: [], distribution: null };
  const primary = requests[0]!;
  const ctx = buildPropSimulationContext(primary, history, game);
  if (!ctx) {
    return {
      rows: requests.map((req) => nullSimPropRow(req, history)),
      distribution: null,
    };
  }
  return simulatePropGroupFromContext(
    requests,
    ctx,
    history,
    distributionKey,
    tier,
    simulations,
    opts,
  );
}

export { keyInjuryWeight };
