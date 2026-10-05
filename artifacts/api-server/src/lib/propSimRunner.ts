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

export type PropSimGameContext = {
  sport: string;
  oppPace: number | null;
  leaguePace: number | null;
  oppKeyInjuries: number;
  ownKeyInjuries: number;
  weatherImpact: number | null;
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
}> {
  const t0 = performance.now();
  const simCount = tierSimCount(tier, simulations);
  const historyCache: HistoryCache = new Map();
  let deepPending = false;
  const distStats = emptyPropDistributionCacheStats();

  type Indexed = { index: number; prop: SimPropRequest; isHome: boolean | null };
  const indexed: Indexed[] = props.map((prop, index) => ({
    index,
    prop,
    isHome: resolveIsHome(prop, isHomeByPlayer),
  }));

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

  return {
    rows: rows as PropSimRow[],
    deepPending: tier === "quick" ? deepPending : false,
    distStats,
    propSimElapsedMs: Math.round(performance.now() - t0),
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
        cachedCtx = loaded.value;
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

