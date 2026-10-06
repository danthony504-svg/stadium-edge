/**
 * Phase 2.1 prop simulation runner — shared by the HTTP route and benches.
 */
import { type SimTier } from "../src/lib/simCache.ts";
import {
  emptyPropDistributionCacheStats,
  getCachedPropDistribution,
  propDistributionCacheKey,
  setCachedPropDistribution,
  withPropSimDistInflight,
  type PropDistributionCacheStats,
} from "../src/lib/propDistributionCache.ts";
import { DEEP_SIMULATIONS, QUICK_SIMULATIONS } from "../src/lib/monteCarlo.ts";
import {
  buildPropSimulationContext,
  diagnosePropSimNullReason,
  propRequestSharedDistributionKey,
  scoreRequestsFromCachedDistribution,
  sharedDistributionPartsForProp,
  simulatePropGroupFromContext,
  type SimPropRequest,
  type SimPropRow as BuiltSimPropRow,
} from "../src/lib/monteCarloBuild.ts";
import {
  PROPSIM_CTX_LOAD_CONCURRENCY,
  cachedPropSimCtxFromContext,
  getCachedPropSimCtx,
  mapWithConcurrency,
  propSimulationContextFromCached,
  setCachedPropSimCtx,
  withPropSimCtxInflight,
  type CachedPropSimCtx,
} from "../src/lib/propSimCtxCache.ts";
import { withInflightCoalesce } from "../src/lib/propSimDedicatedStore.ts";
import { fetchEspnPlayerHistory } from "../src/lib/espnPlayerHistory.ts";
import {
  loadAuthoritativePlayerHistory,
  toEnrichmentHistory,
  type PropSimEnrichmentHistory,
} from "../src/lib/authoritativePlayerHistory.ts";


/** AUDIT-ONLY instrumented copy of runPropSims — not used in production. */

export type PropSimPhaseRow = {
  phase: string;
  count: number;
  start: number;
  end: number;
  exclusiveWallMs: number;
  cpuUserMs: number | null;
  cpuSystemMs: number | null;
  note?: string;
};

export type PropSimGroupTiming = {
  group: number;
  player: string;
  stat: string;
  linesUsingDist: number;
  ctxMs: number;
  fingerprintMs: number;
  distLookupMs: number;
  thresholdEvalMs: number;
  totalMs: number;
  ctxHit: boolean;
  distHit: boolean;
  /** Per-group sync approx (parallel workers; do not sum to phase wall). */
  syncMs?: number;
};

export type PropSimPhaseAudit = {
  enabled: boolean;
  totalWallMs: number;
  phaseSumExclusiveMs: number;
  unexplainedMs: number;
  phases: PropSimPhaseRow[];
  groups: PropSimGroupTiming[];
  eventLoop: {
    samples: number;
    maxDelayMs: number;
    meanDelayMs: number;
    p95DelayMs: number;
    sumDelayMs: number;
  } | null;
  cpuTotal: { userMs: number; systemMs: number } | null;
  awaitGapEstimateMs: number;
  /** Sync wall inside phase 2 (excludes time spent awaiting). */
  contextPhaseSyncMs?: number;
  /** Wall spent inside awaits during phase 2 (event-loop may run other work). */
  contextPhaseAwaitMs?: number;
  /** process.cpuUsage during phase 2 wall (includes concurrent same-process CPU). */
  contextPhaseCpuMs?: number;
  /** Max contiguous sync slice between awaits in phase 2. */
  contextPhaseMaxSyncSliceMs?: number;
  /** Number of await boundaries crossed in phase 2. */
  contextPhaseAwaitCount?: number;
};

export let lastPropSimPhaseAudit: PropSimPhaseAudit | null = null;

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
export async function runPropSimsPhaseAudit(
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
  playerHistories: Record<string, PropSimEnrichmentHistory>;
  historyShared: number;
  historyCoalesced: number;
  phaseAudit: PropSimPhaseAudit;
}> {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  const simCount = tierSimCount(tier, simulations);
  const historyCache: HistoryCache = new Map();
  let deepPending = false;
  const distStats = emptyPropDistributionCacheStats();

  type PhaseAcc = {
    phase: string;
    count: number;
    start: number;
    end: number;
    exclusiveWallMs: number;
    cpuUserUs: number;
    cpuSystemUs: number;
    note?: string;
  };
  const phaseMap = new Map<string, PhaseAcc>();
  const groupTimings: PropSimGroupTiming[] = [];
  const loopDelays: number[] = [];
  let awaitGapEstimateMs = 0;
  let last = performance.now();
  const loopTimer = setInterval(() => {
    const now = performance.now();
    loopDelays.push(Math.max(0, now - last - 5));
    last = now;
  }, 5);
  loopTimer.unref?.();

  const bump = (phase: string, wallMs: number, cpu: NodeJS.CpuUsage, startRel: number, endRel: number, note?: string) => {
    const acc = phaseMap.get(phase) ?? {
      phase, count: 0, start: startRel, end: endRel, exclusiveWallMs: 0, cpuUserUs: 0, cpuSystemUs: 0, note,
    };
    acc.count += 1;
    acc.start = Math.min(acc.start, startRel);
    acc.end = Math.max(acc.end, endRel);
    acc.exclusiveWallMs += wallMs;
    acc.cpuUserUs += cpu.user;
    acc.cpuSystemUs += cpu.system;
    if (note) acc.note = note;
    phaseMap.set(phase, acc);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    if (wallMs > cpuMs + 1) awaitGapEstimateMs += wallMs - cpuMs;
  };

  type Indexed = { index: number; prop: SimPropRequest; isHome: boolean | null };
  let indexed: Indexed[] = [];
  let groupList: Indexed[][] = [];
  let gctx = gameCtxForSimulate(gameCtx);

  {
    const s = performance.now(); const c0 = process.cpuUsage();
    indexed = props.map((prop, index) => ({
      index, prop, isHome: resolveIsHome(prop, isHomeByPlayer),
    }));
    const groups = new Map<string, Indexed[]>();
    for (const item of indexed) {
      const key = propRequestSharedDistributionKey(item.prop, gameCtx, item.isHome);
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }
    groupList = [...groups.values()];
    gctx = gameCtxForSimulate(gameCtx);
    const e = performance.now();
    bump("1_input_normalization_grouping", e - s, process.cpuUsage(c0), s - t0, e - t0);
  }

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

  const ctxTiming = new Map<string, {
    ctxMs: number;
    fingerprintMs: number;
    ctxHit: boolean;
    /** Per-group sync CPU approximation (sums across parallel workers; may exceed phase wall). */
    syncMs: number;
  }>();
  /**
   * Occupancy accounting for phase 2 wall:
   * - sync wall = intervals where zero workers are inside an await
   * - await wall = intervals where ≥1 worker is awaiting
   * These two sum to phase wall (no double-count from concurrency=4).
   */
  let awaitDepth = 0;
  let occMark = 0;
  let contextPhaseSyncMs = 0;
  let contextPhaseAwaitMs = 0;
  let contextPhaseMaxSyncSliceMs = 0;
  let contextPhaseAwaitCount = 0;
  let ctxOcc: {
    syncMs: number;
    awaitMs: number;
    cpuMs: number;
    maxSyncSliceMs: number;
    awaitCount: number;
    wallMs: number;
  } | null = null;
  const enterAwait = () => {
    const now = performance.now();
    if (awaitDepth === 0) {
      // Transition sync → await: close sync slice; start await occupancy.
      const slice = now - occMark;
      contextPhaseSyncMs += slice;
      if (slice > contextPhaseMaxSyncSliceMs) contextPhaseMaxSyncSliceMs = slice;
      occMark = now;
    }
    // If already awaiting, do NOT move occMark — that would erase await occupancy.
    awaitDepth += 1;
    contextPhaseAwaitCount += 1;
  };
  const leaveAwait = () => {
    const now = performance.now();
    if (awaitDepth <= 0) return;
    if (awaitDepth === 1) {
      // Last waiter leaving: close await occupancy, resume sync.
      contextPhaseAwaitMs += now - occMark;
      occMark = now;
    }
    awaitDepth -= 1;
  };
  const timedAwait = async <T>(p: Promise<T>): Promise<T> => {
    enterAwait();
    try {
      return await p;
    } finally {
      leaveAwait();
    }
  };
  const sCtx = performance.now();
  occMark = sCtx;
  const cCtx0 = process.cpuUsage();
  const resolvedPairs = await mapWithConcurrency(
    groupList,
    PROPSIM_CTX_LOAD_CONCURRENCY,
    async (group) => {
      const gKey = `${group[0]!.prop.player}|${group[0]!.prop.market}|${group[0]!.prop.athleteId ?? ""}`;
      const gStart = performance.now();
      let fingerprintMs = 0;
      let gSync = 0;
      let gSyncMark = performance.now();
      const gCloseSync = () => {
        const now = performance.now();
        gSync += now - gSyncMark;
        gSyncMark = now;
      };
      const gResume = () => { gSyncMark = performance.now(); };
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

      gCloseSync();
      const existingCtx = await timedAwait(getCachedPropSimCtx(parts));
      gResume();
      if (existingCtx) {
        meta.ctxHit = true;
        const tFp0 = performance.now();
        const ctx = propSimulationContextFromCached(existingCtx, primaryReq, gctx);
        fingerprintMs = performance.now() - tFp0;
        gCloseSync();
        ctxTiming.set(gKey, {
          ctxMs: performance.now() - gStart,
          fingerprintMs,
          ctxHit: true,
          syncMs: gSync,
        });
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
      gCloseSync();
      const loaded = await timedAwait(withPropSimCtxInflight(parts, async () => {
        gResume();
        gCloseSync();
        const again = await timedAwait(getCachedPropSimCtx(parts));
        gResume();
        if (again) {
          return {
            cachedCtx: again,
            history: null as Awaited<ReturnType<typeof fetchEspnPlayerHistory>> | null,
            historyLoad: false,
          };
        }

        gCloseSync();
        const history = await timedAwait(loadPropHistory(primary.prop, gameCtx, historyCache));
        gResume();
        const built = buildPropSimulationContext(primaryReq, history, gctx);
        if (!built) {
          return { cachedCtx: null, history, historyLoad: true };
        }
        const tFp0 = performance.now();
        const cachedCtx = cachedPropSimCtxFromContext(built);
        fingerprintMs = performance.now() - tFp0;
        gCloseSync();
        await timedAwait(setCachedPropSimCtx(parts, cachedCtx));
        gResume();
        return { cachedCtx, history, historyLoad: true };
      }));
      gResume();
      if (loaded.coalesced) meta.ctxCoalesced = true;
      if (loaded.value.historyLoad && !loaded.coalesced) meta.historyLoad = true;

      const { cachedCtx, history } = loaded.value;
      if (!cachedCtx) {
        gCloseSync();
        ctxTiming.set(gKey, {
          ctxMs: performance.now() - gStart,
          fingerprintMs: 0,
          ctxHit: false,
          syncMs: gSync,
        });
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
      const tFp1 = performance.now();
      const ctx = propSimulationContextFromCached(cachedCtx, primaryReq, gctx);
      fingerprintMs += performance.now() - tFp1;
      gCloseSync();
      ctxTiming.set(gKey, {
        ctxMs: performance.now() - gStart,
        fingerprintMs,
        ctxHit: false,
        syncMs: gSync,
      });
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
  // Close trailing sync slice after last worker settles.
  {
    const now = performance.now();
    if (awaitDepth === 0) {
      const slice = now - occMark;
      contextPhaseSyncMs += slice;
      if (slice > contextPhaseMaxSyncSliceMs) contextPhaseMaxSyncSliceMs = slice;
    }
  }
  {
    const eCtx = performance.now();
    const cpuCtx = process.cpuUsage(cCtx0);
    bump("2_context_lookup_build", eCtx - sCtx, cpuCtx, sCtx - t0, eCtx - t0);
    const fpSum = [...ctxTiming.values()].reduce((a, x) => a + x.fingerprintMs, 0);
    bump("3_history_fingerprint_calculation", fpSum, { user: 0, system: 0 }, sCtx - t0, eCtx - t0, "subset_of_ctx_phase");
    ctxOcc = {
      syncMs: contextPhaseSyncMs,
      awaitMs: contextPhaseAwaitMs,
      cpuMs: (cpuCtx.user + cpuCtx.system) / 1000,
      maxSyncSliceMs: contextPhaseMaxSyncSliceMs,
      awaitCount: contextPhaseAwaitCount,
      wallMs: eCtx - sCtx,
    };
  }


  for (const { meta } of resolvedPairs) {
    if (meta.ctxHit) distStats.ctxCacheHits += 1;
    if (meta.ctxMiss) distStats.ctxCacheMisses += 1;
    if (meta.ctxCoalesced) distStats.ctxCoalesced += 1;
    if (meta.historyLoad) distStats.historyLoads += 1;
  }
  const resolved: ResolvedGroup[] = resolvedPairs.map((p) => p.resolved);

  const rows: PropSimRow[] = new Array(props.length);
  const deepWarmProps: SimPropRequest[] = [];

  let groupIdx = 0;
  const sDistPhase = performance.now(); const cDist0 = process.cpuUsage();
  let keyMs = 0, lookupMs = 0, evalMs = 0, altMs = 0, assignMs = 0;
  for (const rg of resolved) {
    const { group, primaryReq, parts, history, ctx, fingerprint } = rg;
    const gKey = `${primaryReq.player}|${primaryReq.market}|${primaryReq.athleteId ?? ""}`;
    const ct = ctxTiming.get(gKey) ?? { ctxMs: 0, fingerprintMs: 0, ctxHit: false, syncMs: 0 };
    const g0 = performance.now();
    let distLookupMs = 0, thresholdEvalMs = 0, distHit = false, linesUsing = 0;

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
      groupTimings.push({
        group: groupIdx++, player: primaryReq.player, stat: primaryReq.market,
        linesUsingDist: 0, ctxMs: Math.round(ct.ctxMs), fingerprintMs: Math.round(ct.fingerprintMs),
        distLookupMs: 0, thresholdEvalMs: 0, totalMs: Math.round(performance.now() - g0 + ct.ctxMs),
        ctxHit: ct.ctxHit, distHit: false, syncMs: Math.round(ct.syncMs),
      });
      continue;
    }

    const tKey0 = performance.now();
    const distKey = propDistributionCacheKey(parts, fingerprint, tier, simCount);
    keyMs += performance.now() - tKey0;

    const tAlt0 = performance.now();
    const groupLines = [
      ...new Set(
        group
          .flatMap((u) => [u.prop.line, ...(u.prop.additionalLines ?? [])])
          .filter((l) => Number.isFinite(l)),
      ),
    ].sort((a, b) => a - b);
    linesUsing = groupLines.length;

    const requests: SimPropRequest[] = group.map((u) => {
      const extras = groupLines.filter((l) => l !== u.prop.line);
      return {
        ...u.prop,
        sport: propSport(u.prop, gameCtx),
        isHome: u.isHome,
        ...(extras.length ? { additionalLines: extras } : { additionalLines: undefined }),
      };
    });
    altMs += performance.now() - tAlt0;

    const tLook0 = performance.now();
    const cachedDist = await getCachedPropDistribution(distKey);
    distLookupMs = performance.now() - tLook0;
    lookupMs += distLookupMs;
    let results: BuiltSimPropRow[];
    let fromCache = false;

    if (cachedDist?.samples?.length) {
      distStats.distributionCacheHits += 1;
      fromCache = true;
      distHit = true;
      const tEv0 = performance.now();
      results = scoreRequestsFromCachedDistribution(
        requests,
        history,
        ctx,
        cachedDist,
        groupLines,
      );
      thresholdEvalMs = performance.now() - tEv0;
      evalMs += thresholdEvalMs;
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
        const tEv0 = performance.now();
        results = scoreRequestsFromCachedDistribution(
          requests,
          history,
          ctx,
          generated.value.dist,
          groupLines,
        );
        thresholdEvalMs = performance.now() - tEv0;
        evalMs += thresholdEvalMs;
        distHit = true;
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

    {
      const tA0 = performance.now();
      for (let i = 0; i < group.length; i++) {
        const item = group[i]!;
        const result = results[i]!;
        rows[item.index] = { ...result, tier, cached: fromCache };
      }
      assignMs += performance.now() - tA0;
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
    groupTimings.push({
      group: groupIdx++, player: primaryReq.player, stat: primaryReq.market,
      linesUsingDist: linesUsing, ctxMs: Math.round(ct.ctxMs), fingerprintMs: Math.round(ct.fingerprintMs),
      distLookupMs: Math.round(distLookupMs), thresholdEvalMs: Math.round(thresholdEvalMs),
      totalMs: Math.round(performance.now() - g0 + ct.ctxMs),
      ctxHit: ct.ctxHit, distHit, syncMs: Math.round(ct.syncMs),
    });
  }
  {
    const eDist = performance.now();
    bump("4_distribution_key_construction", keyMs, { user: 0, system: 0 }, sDistPhase - t0, eDist - t0);
    bump("5_distribution_cache_lookup", lookupMs, { user: 0, system: 0 }, sDistPhase - t0, eDist - t0);
    bump("7_threshold_probability_evaluation", evalMs, { user: 0, system: 0 }, sDistPhase - t0, eDist - t0);
    bump("8_alt_expansion", altMs, { user: 0, system: 0 }, sDistPhase - t0, eDist - t0);
    bump("13_row_assign", assignMs, { user: 0, system: 0 }, sDistPhase - t0, eDist - t0);
    bump("5_7_8_dist_loop_wall", eDist - sDistPhase, process.cpuUsage(cDist0), sDistPhase - t0, eDist - t0,
      "wall_includes_await_gaps_between_groups");
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
  for (const p of props) {
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
  const sEnr = performance.now(); const cEnr0 = process.cpuUsage();
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
  {
    const eEnr = performance.now();
    bump("13b_phase23_enrich_history_payload", eEnr - sEnr, process.cpuUsage(cEnr0), sEnr - t0, eEnr - t0);
  }

  bump("9_10_11_12_fair_ev_grade_sort_outside", 0, { user: 0, system: 0 }, 0, 0,
    "EV/edge/grade/sort/dedupe happen in Coach after prop-sim returns");

  clearInterval(loopTimer);
  const totalWallMs = performance.now() - t0;
  const cpu1 = process.cpuUsage(cpu0);
  const phases: PropSimPhaseRow[] = [...phaseMap.values()]
    .map((p) => ({
      phase: p.phase,
      count: p.count,
      start: Math.round(p.start),
      end: Math.round(p.end),
      exclusiveWallMs: Math.round(p.exclusiveWallMs),
      cpuUserMs: Math.round(p.cpuUserUs / 1000),
      cpuSystemMs: Math.round(p.cpuSystemUs / 1000),
      note: p.note,
    }))
    .sort((a, b) => a.start - b.start);
  // Reconcile without double-counting subset / nested phases.
  const reconcilePhases = phases.filter((p) =>
    !p.phase.startsWith("3_") &&
    !p.phase.startsWith("9_10_11_12") &&
    !["4_distribution_key_construction", "5_distribution_cache_lookup", "7_threshold_probability_evaluation", "8_alt_expansion", "13_row_assign"].includes(p.phase)
  );
  const phaseSumExclusiveMs = reconcilePhases.reduce((a, p) => a + p.exclusiveWallMs, 0);
  const sortedDelay = [...loopDelays].sort((a, b) => a - b);
  const phaseAudit: PropSimPhaseAudit = {
    enabled: true,
    totalWallMs: Math.round(totalWallMs),
    phaseSumExclusiveMs: Math.round(phaseSumExclusiveMs),
    unexplainedMs: Math.round(totalWallMs - phaseSumExclusiveMs),
    phases,
    groups: groupTimings.sort((a, b) => b.totalMs - a.totalMs),
    eventLoop: sortedDelay.length
      ? {
          samples: sortedDelay.length,
          maxDelayMs: Math.round(sortedDelay[sortedDelay.length - 1]!),
          meanDelayMs: Math.round(sortedDelay.reduce((a, b) => a + b, 0) / sortedDelay.length),
          p95DelayMs: Math.round(sortedDelay[Math.min(sortedDelay.length - 1, Math.ceil(sortedDelay.length * 0.95) - 1)]!),
          sumDelayMs: Math.round(sortedDelay.reduce((a, b) => a + b, 0)),
        }
      : null,
    cpuTotal: { userMs: Math.round(cpu1.user / 1000), systemMs: Math.round(cpu1.system / 1000) },
    awaitGapEstimateMs: Math.round(awaitGapEstimateMs),
    contextPhaseSyncMs: ctxOcc ? Math.round(ctxOcc.syncMs) : undefined,
    contextPhaseAwaitMs: ctxOcc ? Math.round(ctxOcc.awaitMs) : undefined,
    contextPhaseCpuMs: ctxOcc ? Math.round(ctxOcc.cpuMs) : undefined,
    contextPhaseMaxSyncSliceMs: ctxOcc ? Math.round(ctxOcc.maxSyncSliceMs) : undefined,
    contextPhaseAwaitCount: ctxOcc?.awaitCount,
  };
  lastPropSimPhaseAudit = phaseAudit;

  return {
    rows: rows as PropSimRow[],
    deepPending: tier === "quick" ? deepPending : false,
    distStats,
    propSimElapsedMs: Math.round(totalWallMs),
    playerHistories,
    historyShared,
    historyCoalesced,
    phaseAudit,
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

