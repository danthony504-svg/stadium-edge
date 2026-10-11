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
import {
  lookupOpportunityShift,
  opportunityMarketFamily,
  type OpportunityShiftTable,
} from "./opportunityShift/index.js";
import {
  buildPreSimShiftFactors,
  filterSeriesForMarket,
  type PreSimShiftFactors,
} from "./preSimShift/index.js";

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
  /** ESPN team id for the player's own side (never inferred from name). */
  playerTeamId?: string | null;
  /** Extra alt rungs scored on the same 10k draw as `line`. */
  additionalLines?: number[];
};

export type HistoryGameRow = {
  stats: Record<string, string>;
  isHome?: boolean | null;
  opponentId?: string | null;
  periodTag?: string | null;
};

export type PlayerHistoryShape = {
  labels: string[];
  recent: HistoryGameRow[];
  vsOpponent: HistoryGameRow[];
  /** Full-season (or all available) games for venue baseline — preferred over recent-only. */
  seasonGames?: HistoryGameRow[];
  seasonHome?: HistoryGameRow[];
  seasonAway?: HistoryGameRow[];
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
  /** Built once per game — family-specific Opportunity Shift table. */
  opportunityShift?: OpportunityShiftTable | null;
  /**
   * Optional team-key → receiving matchup factor for QB pass coupling
   * (built once per simulate batch from WR/TE histories).
   */
  coupledReceivingMatchupByTeam?: Map<string, number> | null;
  /** Optional opp defense / league index (~1.0) for matchup shift. */
  defenseIndex?: number | null;
  /** Optional per-family defense indices (already normalized ≈1). */
  defenseIndexByFamily?: Record<string, number> | null;
};

/** Minimal game/context fields required to decide distribution sharing. */
export type SharedDistGameContext = {
  sport: string;
  oppPace?: number | null;
  leaguePace?: number | null;
  oppKeyInjuries?: number;
  ownKeyInjuries?: number;
  weatherImpact?: number | null;
  opportunityShiftFingerprint?: string | null;
  opportunityShift?: OpportunityShiftTable | null;
};

function statSeries(
  market: string,
  games: Array<{ stats: Record<string, string>; periodTag?: string | null }>,
  labels: string[],
): { values: number[]; tags: string[] } {
  const ambiguous = computeAmbiguous(labels);
  const values: number[] = [];
  const tags: string[] = [];
  for (const g of games) {
    const v = gameValueForMarket(market, g.stats, ambiguous);
    if (v != null && Number.isFinite(v)) {
      values.push(v);
      tags.push(String(g.periodTag ?? "full"));
    }
  }
  // Live-path period isolation: drop period-tagged rows for full-game markets.
  const filtered = filterSeriesForMarket(market, values, tags);
  // Rebuild tags aligned to filtered values (filterSeriesForMarket drops by index).
  if (filtered.length === values.length) return { values, tags };
  const outVals: number[] = [];
  const outTags: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const tag = tags[i] ?? "full";
    const keep = filterSeriesForMarket(market, [values[i]!], [tag]);
    if (keep.length) {
      outVals.push(values[i]!);
      outTags.push(tag);
    }
  }
  return { values: outVals, tags: outTags };
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
  const { values: recentValues } = statSeries(req.market, history.recent, labels);
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
  const { values: recentValues } = statSeries(req.market, history.recent, labels);
  if (recentValues.length < 3) return null;

  const seasonGames = history.seasonGames?.length ? history.seasonGames : history.recent;
  const seasonHome = history.seasonHome?.length
    ? history.seasonHome
    : history.recent.filter((g) => g.isHome === true);
  const seasonAway = history.seasonAway?.length
    ? history.seasonAway
    : history.recent.filter((g) => g.isHome === false);

  const seasonSeries = statSeries(req.market, seasonGames, labels);
  const vsSeries = statSeries(req.market, history.vsOpponent ?? [], labels);
  const homeSeries = statSeries(req.market, seasonHome, labels);
  const awaySeries = statSeries(req.market, seasonAway, labels);
  const recentHome = statSeries(
    req.market,
    history.recent.filter((g) => g.isHome === true),
    labels,
  );
  const recentAway = statSeries(
    req.market,
    history.recent.filter((g) => g.isHome === false),
    labels,
  );

  const opp = lookupOpportunityShift(game.opportunityShift, {
    player: req.player,
    athleteId: req.athleteId,
    market: req.market,
    sport: req.sport,
  });

  const family = opp.family ?? opportunityMarketFamily(req.market, req.sport);
  const defenseIndex =
    (family && game.defenseIndexByFamily?.[family]) ??
    game.defenseIndex ??
    null;

  // Side key: "home" | "away" — populated by runPropSims for QB←WR coupling.
  const sideKey =
    req.isHome === true ? "home" : req.isHome === false ? "away" : "";
  const coupledReceiving =
    (sideKey && game.coupledReceivingMatchupByTeam?.get(sideKey)) || null;

  const recentVenue =
    req.isHome === true
      ? recentHome
      : req.isHome === false
        ? recentAway
        : { values: [] as number[], tags: [] as string[] };

  const pre: PreSimShiftFactors = buildPreSimShiftFactors({
    sport: req.sport,
    market: req.market,
    isHome: req.isHome,
    seasonValues: seasonSeries.values.length ? seasonSeries.values : recentValues,
    homeValues: homeSeries.values,
    awayValues: awaySeries.values,
    vsOpponentValues: vsSeries.values,
    recentVenueValues: recentVenue.values,
    seasonTags: seasonSeries.tags,
    homeTags: homeSeries.tags,
    awayTags: awaySeries.tags,
    recentVenueTags: recentVenue.tags,
    vsOpponentTags: vsSeries.tags,
    opportunityShift: opp.multiplier,
    opportunityExplain: opp.explanation,
    opportunityFamily: family,
    defenseIndex,
    coupledReceivingMatchup: coupledReceiving,
  });

  return {
    sport: req.sport,
    market: req.market,
    line: req.line,
    side: req.side,
    recentValues,
    vsOpponentValues: vsSeries.values,
    homeValues: homeSeries.values,
    awayValues: awaySeries.values,
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
    opportunityFamilyMult: pre.opportunityShift,
    opportunityFamily: pre.family ?? opp.family,
    opportunityExplain: pre.opportunityExplain ?? opp.explanation,
    opportunitySuppressOwnInjuries: opp.suppressOwnKeyInjuries,
    venueFamilyMult: pre.venueShift,
    matchupFamilyMult: pre.opponentMatchupShift,
    combinedPreSimMult: pre.combinedShift,
    volumePreSimMult: pre.volumeShift,
    efficiencyPreSimMult: pre.efficiencyShift,
    preSimShiftKind: pre.shiftKind,
    venueExplain: pre.venueExplain,
    matchupExplain: pre.matchupExplain,
    combinedPreSimExplain: pre.combinedExplain,
    suppressSoftVenueBlend: pre.suppressSoftVenueBlend,
    suppressSoftVsOpponentBlend: pre.suppressSoftVsOpponentBlend,
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
    opportunityShiftFingerprint:
      game.opportunityShiftFingerprint ??
      game.opportunityShift?.tableFingerprint ??
      null,
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
