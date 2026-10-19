import type { PreparedGameContext } from "./preparedGameContext.js";
import { propHasConfirmedAbsence, propHasConfirmedNonstarter } from "./propAvailability.js";
/**
 * Phase 2.1 prop simulation runner — shared by the HTTP route and benches.
 */
import { type SimTier } from "./simCache.js";
import {
  emptyPropDistributionCacheStats,
  getCachedPropDistribution,
  propDistributionCacheKey,
  setCachedPropDistribution,
  withPropSimDistInflight,
  type PropDistributionCacheStats,
} from "./propDistributionCache.js";
import { DEEP_SIMULATIONS, QUICK_SIMULATIONS } from "./monteCarlo.js";
import {
  buildPropSimulationContext,
  diagnosePropSimNullReason,
  propRequestSharedDistributionKey,
  scoreRequestsFromCachedDistribution,
  sharedDistributionPartsForProp,
  simulatePropGroupFromContext,
  type SimPropRequest,
  type SimPropRow as BuiltSimPropRow,
} from "./monteCarloBuild.js";
import {
  PROPSIM_CTX_LOAD_CONCURRENCY,
  cachedPropSimCtxFromContext,
  getCachedPropSimCtx,
  mapWithConcurrency,
  propSimulationContextFromCached,
  setCachedPropSimCtx,
  withPropSimCtxInflight,
  type CachedPropSimCtx,
} from "./propSimCtxCache.js";
import { withInflightCoalesce } from "./propSimDedicatedStore.js";
import { fetchEspnPlayerHistory } from "./espnPlayerHistory.js";
import {
  loadAuthoritativePlayerHistory,
  peekAuthoritativePlayerHistory,
  toPropSimHistoryShape,
  toEnrichmentHistory,
  type PropSimEnrichmentHistory,
} from "./authoritativePlayerHistory.js";

import {
  buildOpportunityShiftForGame,
  classifyVacancyConfirmation,
  vacancyFractionForConfirmation,
  teamMatch,
  deriveChannelUsageFromHistory,
  opportunityMarketFamily,
  type EspnInjuryTeamLike,
  type OpportunityShiftTable,
  type PropPlayerLike,
} from "./opportunityShift/index.js";
import {
  aggregateReceivingMatchupForQb,
  buildPreSimShiftFactors,
  isReceivingFamilyForQbCoupling,
} from "./preSimShift/index.js";
import { computeAmbiguous, gameValueForMarket } from "./propStatValue.js";

export type OpportunityShiftBuildInputs = {
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  injuries: readonly EspnInjuryTeamLike[];
  /** Prop/beneficiary stubs — channelUsage filled from histories inside runPropSims. */
  players: readonly PropPlayerLike[];
};

export type PropSimGameContext = {
  preparedContext?: PreparedGameContext | null;
  sport: string;
  oppPace: number | null;
  leaguePace: number | null;
  oppKeyInjuries: number;
  ownKeyInjuries: number;
  weatherImpact: number | null;
  /**
   * Pre-built table (tests / callers that already have usage). When
   * `opportunityShiftInputs` is set, runPropSims rebuilds after history load.
   */
  opportunityShift?: OpportunityShiftTable | null;
  /** Preferred: build Opp Shift after parallel history wave (HTTP + Coach). */
  opportunityShiftInputs?: OpportunityShiftBuildInputs | null;
  /** Opp defense / league index (~1) for Opponent Matchup Shift. */
  defenseIndex?: number | null;
  /** Optional per-family defense indices already on the request (no new I/O). */
  defenseIndexByFamily?: Record<string, number> | null;
  /** Side ("home"|"away") → receiving matchup for QB pass coupling. */
  coupledReceivingMatchupByTeam?: Map<string, number> | null;
};

export type PropSimRow = BuiltSimPropRow & {
  tier: SimTier;
  cached: boolean;
  deepPending?: boolean;
};

export function tierSimCount(tier: SimTier, simulations?: number): number {
  if (simulations && Number.isFinite(simulations) && simulations > 0) return simulations;
  return tier === "deep" ? DEEP_SIMULATIONS : QUICK_SIMULATIONS;
}

function propSport(p: SimPropRequest, gameCtx: PropSimGameContext): string {
  return String(p.sport ?? gameCtx.sport).toLowerCase();
}

function resolveIsHome(
  p: SimPropRequest,
  isHomeByPlayer: Record<string, boolean>,
): boolean | null {
  return p.isHome ?? isHomeByPlayer[p.player] ?? null;
}

type HistoryCache = Map<string, Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null>;

/** Sync: usage-weighted receiving matchup factors for QB←WR coupling. */
function buildCoupledReceivingBySide(
  indexed: Array<{ prop: SimPropRequest; isHome: boolean | null }>,
  gameCtx: PropSimGameContext,
  historyCache: HistoryCache,
): Map<string, number> {
  type CouplingRow = {
    factor: number;
    expectedTargets: number | null;
    recentTargets: number | null;
    receivingYards: number | null;
  };
  const bySide = new Map<string, CouplingRow[]>();
  // Prefer one row per athlete (highest-usage receiving market).
  const seenAthlete = new Set<string>();

  for (const item of indexed) {
    const fam = opportunityMarketFamily(item.prop.market, propSport(item.prop, gameCtx));
    if (!isReceivingFamilyForQbCoupling(fam)) continue;
    const side =
      item.isHome === true ? "home" : item.isHome === false ? "away" : null;
    if (!side) continue;
    const athleteId = String(item.prop.athleteId ?? "").trim();
    if (!athleteId) continue;
    const dedupe = `${side}:${athleteId}`;
    if (seenAthlete.has(dedupe)) continue;
    seenAthlete.add(dedupe);

    const sportKey = propSport(item.prop, gameCtx);
    let history: Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null = null;
    const prefix = `${sportKey}:${athleteId}:`;
    for (const [k, v] of historyCache) {
      if (k.startsWith(prefix)) {
        history = v;
        break;
      }
    }
    if (!history?.recent?.length) continue;
    const labels = history.labels ?? [];
    const amb = computeAmbiguous(labels);
    const seasonPool = history.seasonGames?.length ? history.seasonGames : history.recent;
    const seasonHome = history.seasonHome?.length
      ? history.seasonHome
      : history.recent.filter((g) => g.isHome === true);
    const seasonAway = history.seasonAway?.length
      ? history.seasonAway
      : history.recent.filter((g) => g.isHome === false);

    const pull = (market: string, games: typeof history.recent) => {
      const out: number[] = [];
      for (const g of games) {
        const v = gameValueForMarket(market, g.stats, amb);
        if (v != null && Number.isFinite(v)) out.push(v);
      }
      return out;
    };

    const market = item.prop.market;
    const seasonValues = pull(market, seasonPool);
    const homeValues = pull(market, seasonHome);
    const awayValues = pull(market, seasonAway);
    const vsOpponentValues = pull(market, history.vsOpponent ?? []);
    const targetSeries = pull("player_targets", history.recent);
    const recYdsSeries = pull("player_reception_yds", history.recent);

    const pre = buildPreSimShiftFactors({
      sport: sportKey,
      market,
      isHome: item.isHome,
      seasonValues,
      homeValues,
      awayValues,
      vsOpponentValues,
      opportunityShift: 1,
      defenseIndex:
        (fam && gameCtx.defenseIndexByFamily?.[fam]) ?? gameCtx.defenseIndex ?? null,
    });
    if (pre.opponentMatchupShift === 1) continue;

    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const arr = bySide.get(side) ?? [];
    arr.push({
      factor: pre.opponentMatchupShift,
      expectedTargets: null, // no projected targets on hot path without new I/O
      recentTargets: mean(targetSeries),
      receivingYards: mean(recYdsSeries),
    });
    bySide.set(side, arr);
  }
  const out = new Map<string, number>();
  for (const [side, rows] of bySide) {
    const agg = aggregateReceivingMatchupForQb(rows);
    if (agg != null) out.set(side, agg);
  }
  return out;
}

async function loadPropHistory(
  p: SimPropRequest,
  gameCtx: PropSimGameContext,
  historyCache: HistoryCache,
): Promise<Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null> {
  const sportKey = propSport(p, gameCtx);
  const athleteId = p.athleteId ?? "";
  const histKey = `${sportKey}:${athleteId}:${p.opponentTeamId ?? ""}`;
  const cached = historyCache.get(histKey);
  if (cached !== undefined) return cached;

  // Coalesce concurrent identical ESPN history loads across parallel group workers.
  const { value } = await withInflightCoalesce(`hist:${histKey}`, async () => {
    const again = historyCache.get(histKey);
    if (again !== undefined) return again;
    const history = athleteId
      ? await fetchEspnPlayerHistory(sportKey, athleteId, p.opponentTeamId ?? undefined)
      : null;
    historyCache.set(histKey, history);
    return history;
  });
  return value;
}

function gameCtxForSimulate(gameCtx: PropSimGameContext) {
  return {
    sport: gameCtx.sport,
    oppPace: gameCtx.oppPace,
    leaguePace: gameCtx.leaguePace,
    oppKeyInjuries: gameCtx.oppKeyInjuries,
    ownKeyInjuries: gameCtx.ownKeyInjuries,
    weatherImpact: gameCtx.weatherImpact,
    playerHistories: new Map(),
    opportunityShift: gameCtx.opportunityShift ?? null,
    defenseIndex: gameCtx.defenseIndex ?? null,
    defenseIndexByFamily: gameCtx.defenseIndexByFamily ?? null,
    coupledReceivingMatchupByTeam: gameCtx.coupledReceivingMatchupByTeam ?? null,
  };
}

/**
 * Phase 1 + 2.1: group compatible props, resolve propsim-ctx (fingerprint material)
 * with bounded concurrency + coalesce, then dist cache / 10k gen with coalesce.
 * Distributions remain keyed by history fingerprint — never bypassed.
 */
export async function runPropSims(
  props: SimPropRequest[],
  tier: SimTier,
  gameCtx: PropSimGameContext,
  isHomeByPlayer: Record<string, boolean>,
  simulations?: number,
): Promise<{
  rows: PropSimRow[];
  deepPending: boolean;
  distStats: PropDistributionCacheStats;
  propSimElapsedMs: number;
  /** Authoritative histories for Coach enrich — same ESPN material propsim used. */
  playerHistories: Record<string, PropSimEnrichmentHistory>;
  historyShared: number;
  historyCoalesced: number;
}> {
  const t0 = performance.now();
  const simCount = tierSimCount(tier, simulations);
  const historyCache: HistoryCache = new Map();
  let deepPending = false;
  const distStats = emptyPropDistributionCacheStats();

  type Indexed = { index: number; prop: SimPropRequest; isHome: boolean | null };
  const allIndexed: Indexed[] = props.map((prop, index) => ({
    index,
    prop,
    isHome: resolveIsHome(prop, isHomeByPlayer),
  }));

  const unavailableReasons = new Map<number, "confirmed_unavailable" | "confirmed_nonstarter">();
  for (const { index, prop, isHome } of allIndexed) {
    if (propHasConfirmedAbsence({ ...prop, isHome }, gameCtx.sport, gameCtx.opportunityShiftInputs)) unavailableReasons.set(index, "confirmed_unavailable");
    else if (propHasConfirmedNonstarter({ ...prop, isHome }, gameCtx.sport, gameCtx.preparedContext)) unavailableReasons.set(index, "confirmed_nonstarter");
  }
  const unavailable = unavailableReasons;
  const indexed = allIndexed.filter(item => !unavailable.has(item.index));

  // --- Wave 0: parallel history prefetch for unique athletes (no new I/O beyond
  // the same loads propsim already needs). Sync Opp Shift build uses this cache.
  const prefetchKeys = new Map<string, SimPropRequest>();
  for (const item of indexed) {
    const athleteId = String(item.prop.athleteId ?? "").trim();
    if (!athleteId) continue;
    const sportKey = propSport(item.prop, gameCtx);
    const key = `${sportKey}:${athleteId}`;
    if (!prefetchKeys.has(key)) prefetchKeys.set(key, item.prop);
  }
  if (prefetchKeys.size) {
    await mapWithConcurrency(
      [...prefetchKeys.values()],
      PROPSIM_CTX_LOAD_CONCURRENCY,
      async (p) => loadPropHistory(p, gameCtx, historyCache),
    );
  }

  // Sync: build Opportunity Shift from already-loaded histories (identical for
  // HTTP simulate + Coach in-process when opportunityShiftInputs is provided).
  if (gameCtx.opportunityShiftInputs) {
    const inputs = gameCtx.opportunityShiftInputs;
    // Vacant players may have no posted prop. Reuse only histories the cron /
    // earlier requests already loaded; never add a history fetch to the build.
    const sourcePlayers: PropPlayerLike[] = [...inputs.players];
    for (const team of inputs.injuries) {
      if (!teamMatch(team.team ?? "", inputs.homeTeam) && !teamMatch(team.team ?? "", inputs.awayTeam)) continue;
      for (const entry of team.entries ?? []) {
        if (vacancyFractionForConfirmation(classifyVacancyConfirmation(entry.status ?? "")) <= 0) continue;
        if (!entry.athleteId || !entry.player || sourcePlayers.some(p => p.athleteId === entry.athleteId)) continue;
        sourcePlayers.push({ player: entry.player, athleteId: entry.athleteId, team: team.team, position: entry.position });
      }
    }
    const playersWithUsage: PropPlayerLike[] = sourcePlayers.map((p) => {
      const athleteId = String(p.athleteId ?? "").trim();
      const sportKey = String(gameCtx.sport ?? "").toLowerCase();
      // Any cached hist for this athlete (opponent suffix varies).
      let history: Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null = null;
      if (athleteId) {
        const prefix = `${sportKey}:${athleteId}:`;
        for (const [k, v] of historyCache) {
          if (k.startsWith(prefix)) {
            history = v;
            break;
          }
        }
      }
      const warm = athleteId ? peekAuthoritativePlayerHistory(sportKey, athleteId) : undefined;
      if (!history && warm) history = toPropSimHistoryShape(warm);
      const derived = deriveChannelUsageFromHistory(history);
      return {
        ...p,
        channelUsage: {
          ...(p.channelUsage ?? {}),
          ...derived.channelUsage,
        },
        channelUsageSamples: {
          ...(p.channelUsageSamples ?? {}),
          ...derived.channelUsageSamples,
        },
      };
    });
    gameCtx = {
      ...gameCtx,
      opportunityShift: buildOpportunityShiftForGame({
        sport: gameCtx.sport,
        gameKey: inputs.gameKey,
        homeTeam: inputs.homeTeam,
        awayTeam: inputs.awayTeam,
        injuries: inputs.injuries,
        players: playersWithUsage,
      }),
    };
  }

  // Sync: QB←receiving coupling from already-loaded WR/TE histories (no new I/O).
  const coupledReceiving = buildCoupledReceivingBySide(indexed, gameCtx, historyCache);
  if (coupledReceiving.size) {
    gameCtx = {
      ...gameCtx,
      coupledReceivingMatchupByTeam: coupledReceiving,
    };
  }

  const groups = new Map<string, Indexed[]>();
  for (const item of indexed) {
    const key = propRequestSharedDistributionKey(
      item.prop,
      gameCtx,
      item.isHome,
    );
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  const groupList = [...groups.values()];
  const gctx = gameCtxForSimulate(gameCtx);

  type ResolvedGroup = {
    group: Indexed[];
    primaryReq: SimPropRequest;
    parts: ReturnType<typeof sharedDistributionPartsForProp>;
    cachedCtx: CachedPropSimCtx | null;
    history: Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null;
    ctx: ReturnType<typeof buildPropSimulationContext>;
    fingerprint: string | null;
  };

  // --- Phase 2.1: resolve propsim-ctx for all groups (bounded parallel on misses) ---
  type ResolveMeta = {
    ctxHit: boolean;
    ctxMiss: boolean;
    ctxCoalesced: boolean;
    historyLoad: boolean;
  };

  const resolvedPairs = await mapWithConcurrency(
    groupList,
    PROPSIM_CTX_LOAD_CONCURRENCY,
    async (group) => {
      const meta: ResolveMeta = {
        ctxHit: false,
        ctxMiss: false,
        ctxCoalesced: false,
        historyLoad: false,
      };
      const primary = group[0]!;
      const primaryReq: SimPropRequest = {
        ...primary.prop,
        sport: propSport(primary.prop, gameCtx),
        isHome: primary.isHome,
      };
      const parts = sharedDistributionPartsForProp(primaryReq, gameCtx, primary.isHome);

      const existingCtx = await getCachedPropSimCtx(parts);
      if (existingCtx) {
        meta.ctxHit = true;
        const ctx = propSimulationContextFromCached(existingCtx, primaryReq, gctx);
        return {
          meta,
          resolved: {
            group,
            primaryReq,
            parts,
            cachedCtx: existingCtx,
            history: null as Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null,
            ctx,
            fingerprint: existingCtx.fingerprint,
          } satisfies ResolvedGroup,
        };
      }

      meta.ctxMiss = true;
      const loaded = await withPropSimCtxInflight(parts, async () => {
        const again = await getCachedPropSimCtx(parts);
        if (again) {
          return {
            cachedCtx: again,
            history: null as Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null,
            historyLoad: false,
          };
        }

        const history = await loadPropHistory(primary.prop, gameCtx, historyCache);
        const built = buildPropSimulationContext(primaryReq, history, gctx);
        if (!built) {
          return { cachedCtx: null, history, historyLoad: true };
        }
        const cachedCtx = cachedPropSimCtxFromContext(built);
        await setCachedPropSimCtx(parts, cachedCtx);
        return { cachedCtx, history, historyLoad: true };
      });
      if (loaded.coalesced) meta.ctxCoalesced = true;
      if (loaded.value.historyLoad && !loaded.coalesced) meta.historyLoad = true;

      const { cachedCtx, history } = loaded.value;
      if (!cachedCtx) {
        return {
          meta,
          resolved: {
            group,
            primaryReq,
            parts,
            cachedCtx: null,
            history,
            ctx: null,
            fingerprint: null,
          } satisfies ResolvedGroup,
        };
      }
      const ctx = propSimulationContextFromCached(cachedCtx, primaryReq, gctx);
      return {
        meta,
        resolved: {
          group,
          primaryReq,
          parts,
          cachedCtx,
          history,
          ctx,
          fingerprint: cachedCtx.fingerprint,
        } satisfies ResolvedGroup,
      };
    },
  );

  for (const { meta } of resolvedPairs) {
    if (meta.ctxHit) distStats.ctxCacheHits += 1;
    if (meta.ctxMiss) distStats.ctxCacheMisses += 1;
    if (meta.ctxCoalesced) distStats.ctxCoalesced += 1;
    if (meta.historyLoad) distStats.historyLoads += 1;
  }
  const resolved: ResolvedGroup[] = resolvedPairs.map((p) => p.resolved);

  const rows: PropSimRow[] = new Array(props.length);
  for (const { index, prop } of allIndexed) {
    if (!unavailable.has(index)) continue;
    rows[index] = {
      key: `${prop.player}|${prop.market}|${prop.line}|${prop.side}`,
      player: prop.player, market: prop.market, line: prop.line, side: prop.side,
      simulations: 0, hitProbability: null, mostLikelyLine: null,
      meanProjection: null, medianProjection: null, confidenceScore: null,
      stdDev: null, sampleGames: 0, percentiles: null,
      nullReason: unavailableReasons.get(index)!, tier, cached: false,
    };
  }
  const deepWarmProps: SimPropRequest[] = [];

  for (const rg of resolved) {
    const { group, primaryReq, parts, history, ctx, fingerprint } = rg;

    if (!ctx || !fingerprint) {
      for (const item of group) {
        rows[item.index] = {
          key: `${item.prop.player}|${item.prop.market}|${item.prop.line}|${item.prop.side}`,
          player: item.prop.player,
          market: item.prop.market,
          line: item.prop.line,
          side: item.prop.side,
          simulations: 0,
          hitProbability: null,
          mostLikelyLine: null,
          meanProjection: null,
          medianProjection: null,
          confidenceScore: null,
          stdDev: null,
          sampleGames: history?.recent?.length ?? 0,
          percentiles: null,
          nullReason: diagnosePropSimNullReason(
            { ...item.prop, sport: propSport(item.prop, gameCtx), isHome: item.isHome },
            history,
          ),
          tier,
          cached: false,
        };
      }
      continue;
    }

    const distKey = propDistributionCacheKey(parts, fingerprint, tier, simCount);

    const groupLines = [
      ...new Set(
        group
          .flatMap((u) => [u.prop.line, ...(u.prop.additionalLines ?? [])])
          .filter((l) => Number.isFinite(l)),
      ),
    ].sort((a, b) => a - b);

    const requests: SimPropRequest[] = group.map((u) => {
      const extras = groupLines.filter((l) => l !== u.prop.line);
      return {
        ...u.prop,
        sport: propSport(u.prop, gameCtx),
        isHome: u.isHome,
        ...(extras.length ? { additionalLines: extras } : { additionalLines: undefined }),
      };
    });

    const cachedDist = await getCachedPropDistribution(distKey);
    let results: BuiltSimPropRow[];
    let fromCache = false;

    if (cachedDist?.samples?.length) {
      distStats.distributionCacheHits += 1;
      fromCache = true;
      results = scoreRequestsFromCachedDistribution(
        requests,
        history,
        ctx,
        cachedDist,
        groupLines,
      );
      const scored = results.filter((r) => r.hitProbability != null).length;
      distStats.thresholdsEvaluatedFromCache += scored;
      distStats.monteCarloDrawsAvoided += cachedDist.simulations;
    } else {
      distStats.distributionCacheMisses += 1;
      const generated = await withPropSimDistInflight(distKey, async () => {
        const again = await getCachedPropDistribution(distKey);
        if (again?.samples?.length) {
          return { dist: again, drew: false as const };
        }
        const drawn = simulatePropGroupFromContext(
          requests,
          ctx,
          history,
          distKey,
          tier,
          simCount,
        );
        if (drawn.distribution) {
          await setCachedPropDistribution(distKey, drawn.distribution, tier);
        }
        return { dist: drawn.distribution, drew: true as const, rows: drawn.rows };
      });
      if (generated.coalesced) distStats.distCoalesced += 1;

      if (
        generated.value.dist?.samples?.length &&
        (!generated.value.drew || generated.coalesced)
      ) {
        // Cache filled by a peer (pre-check race) or we coalesced onto their draw.
        // Do not count waiters as generators — only the non-coalesced drawer does.
        fromCache = true;
        distStats.distributionCacheHits += 1;
        distStats.distributionCacheMisses -= 1;
        results = scoreRequestsFromCachedDistribution(
          requests,
          history,
          ctx,
          generated.value.dist,
          groupLines,
        );
        const scored = results.filter((r) => r.hitProbability != null).length;
        distStats.thresholdsEvaluatedFromCache += scored;
        distStats.monteCarloDrawsAvoided += generated.value.dist.simulations;
      } else if (
        generated.value.drew &&
        !generated.coalesced &&
        "rows" in generated.value
      ) {
        results = generated.value.rows;
        if (generated.value.dist) {
          distStats.distributionsGenerated += 1;
          distStats.monteCarloDrawsExecuted += generated.value.dist.simulations;
          const scored = results.filter((r) => r.hitProbability != null).length;
          distStats.thresholdsEvaluatedFromFreshDraw += scored;
        }
      } else {
        results = requests.map((req) => ({
          key: `${req.player}|${req.market}|${req.line}|${req.side}`,
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
          sampleGames: 0,
          percentiles: null,
          nullReason: diagnosePropSimNullReason(req, history),
        }));
      }
    }

    for (let i = 0; i < group.length; i++) {
      const item = group[i]!;
      const result = results[i]!;
      rows[item.index] = { ...result, tier, cached: fromCache };
    }

    if (tier === "quick") {
      const deepKey = propDistributionCacheKey(
        parts,
        fingerprint,
        "deep",
        DEEP_SIMULATIONS,
      );
      const deepHit = await getCachedPropDistribution(deepKey);
      if (!deepHit) {
        deepPending = true;
        deepWarmProps.push(primaryReq);
      }
    }
  }

  if (tier === "quick" && deepWarmProps.length) {
    scheduleDeepSim(deepWarmProps, gameCtx, isHomeByPlayer);
  }

  // Phase 2.3: ensure enrichment-ready history is available for every athlete
  // in this batch (reuse authoritative store filled during ctx miss loads;
  // on ctx hit, load/join the same store so enrich does not re-hit ESPN via HTTP).
  const playerHistories: Record<string, PropSimEnrichmentHistory> = {};
  let historyShared = 0;
  let historyCoalesced = 0;
  const athleteKeys = new Map<string, { sport: string; athleteId: string; opponentTeamId?: string }>();
  for (const { prop: p } of indexed) {
    const athleteId = String(p.athleteId ?? "").trim();
    if (!athleteId) continue;
    const sportKey = propSport(p, gameCtx);
    const mapKey = `${sportKey}:${athleteId}`;
    if (athleteKeys.has(mapKey)) continue;
    athleteKeys.set(mapKey, {
      sport: sportKey,
      athleteId,
      opponentTeamId: p.opponentTeamId ?? undefined,
    });
  }
  const histLoads = await mapWithConcurrency(
    [...athleteKeys.values()],
    PROPSIM_CTX_LOAD_CONCURRENCY,
    async (a) => {
      const { history, coalesced } = await loadAuthoritativePlayerHistory(a.sport, a.athleteId);
      if (!history) return { coalesced, shared: false as const };
      playerHistories[a.athleteId] = toEnrichmentHistory(history, a.opponentTeamId);
      return { coalesced, shared: true as const };
    },
  );
  for (const h of histLoads) {
    if (h.coalesced) historyCoalesced += 1;
    if (h.shared) historyShared += 1;
  }
  return {
    rows: rows as PropSimRow[],
    deepPending: tier === "quick" ? deepPending : false,
    distStats,
    propSimElapsedMs: Math.round(performance.now() - t0),
    playerHistories,
    historyShared,
    historyCoalesced,
  };
}

function scheduleDeepSim(
  props: SimPropRequest[],
  gameCtx: PropSimGameContext,
  isHomeByPlayer: Record<string, boolean>,
): void {
  void warmDeepSims(props, gameCtx, isHomeByPlayer).catch(() => {
    /* background warm is best-effort */
  });
}

export async function warmDeepSims(
  props: SimPropRequest[],
  gameCtx: PropSimGameContext,
  isHomeByPlayer: Record<string, boolean>,
): Promise<void> {
  const historyCache: HistoryCache = new Map();
  const gctx = gameCtxForSimulate(gameCtx);

  type Indexed = { prop: SimPropRequest; isHome: boolean | null };
  const groups = new Map<string, Indexed[]>();
  for (const p of props) {
    const isHome = resolveIsHome(p, isHomeByPlayer);
    const key = propRequestSharedDistributionKey(p, gameCtx, isHome);
    const arr = groups.get(key) ?? [];
    arr.push({ prop: p, isHome });
    groups.set(key, arr);
  }

  await mapWithConcurrency(
    [...groups.values()],
    PROPSIM_CTX_LOAD_CONCURRENCY,
    async (group) => {
      const primary = group[0]!;
      const primaryReq: SimPropRequest = {
        ...primary.prop,
        sport: propSport(primary.prop, gameCtx),
        isHome: primary.isHome,
      };
      const parts = sharedDistributionPartsForProp(primaryReq, gameCtx, primary.isHome);

      let cachedCtx = await getCachedPropSimCtx(parts);
      let history: Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null = null;
      if (!cachedCtx) {
        const loaded = await withPropSimCtxInflight(parts, async () => {
          const again = await getCachedPropSimCtx(parts);
          if (again) return again;
          history = await loadPropHistory(primary.prop, gameCtx, historyCache);
          const built = buildPropSimulationContext(primaryReq, history, gctx);
          if (!built) return null;
          const created = cachedPropSimCtxFromContext(built);
          await setCachedPropSimCtx(parts, created);
          return created;
        });
        cachedCtx = loaded.value ?? undefined;
      }
      if (!cachedCtx) return;

      const fingerprint = cachedCtx.fingerprint;
      const deepKey = propDistributionCacheKey(
        parts,
        fingerprint,
        "deep",
        DEEP_SIMULATIONS,
      );

      const existing = await getCachedPropDistribution(deepKey);
      if (existing?.samples?.length) return;

      await withPropSimDistInflight(deepKey, async () => {
        const again = await getCachedPropDistribution(deepKey);
        if (again?.samples?.length) return again;

        const ctx = propSimulationContextFromCached(cachedCtx!, primaryReq, gctx);
        const groupLines = [
          ...new Set(
            group
              .flatMap((u) => [u.prop.line, ...(u.prop.additionalLines ?? [])])
              .filter((l) => Number.isFinite(l)),
          ),
        ].sort((a, b) => a - b);

        const requests: SimPropRequest[] = group.map((u) => {
          const extras = groupLines.filter((l) => l !== u.prop.line);
          return {
            ...u.prop,
            sport: propSport(u.prop, gameCtx),
            isHome: u.isHome,
            ...(extras.length ? { additionalLines: extras } : { additionalLines: undefined }),
          };
        });

        const drawn = simulatePropGroupFromContext(
          requests,
          ctx,
          history,
          deepKey,
          "deep",
          DEEP_SIMULATIONS,
        );
        if (drawn.distribution) {
          await setCachedPropDistribution(deepKey, drawn.distribution, "deep");
        }
        return drawn.distribution;
      });
    },
  );
}

