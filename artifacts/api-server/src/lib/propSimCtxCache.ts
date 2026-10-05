/**
 * Phase 2.1 — propsim-ctx cache.
 * Stores the minimal material needed to reconstruct the history fingerprint
 * and score thresholds without reloading ~1MB ESPN gamelogs.
 *
 * Dist key still embeds fingerprint — this cache never bypasses validation.
 */

import type { PropSimulationContext } from "./monteCarlo.js";
import {
  propHistoryFingerprint,
  type PropDistributionCacheStats,
} from "./propDistributionCache.js";
import {
  propSharedDistributionKey,
  type PropSharedDistributionParts,
} from "./propSharedDistribution.js";
import {
  getPropSimCtxStore,
  setPropSimCtxStore,
  withInflightCoalesce,
} from "./propSimDedicatedStore.js";

/** Align with ESPN player-history cachedJson TTL. */
export const PROPSIM_CTX_TTL_MS = 30 * 60_000;

/** Bounded concurrency for cold ctx/history loads. */
export const PROPSIM_CTX_LOAD_CONCURRENCY = 4;

/**
 * Fingerprint material + confidence inputs. No sportsbook line/side/odds/price.
 * Line/side are applied from the live request when scoring.
 */
export type CachedPropSimCtx = {
  fingerprint: string;
  recentValues: number[];
  vsOpponentValues: number[];
  homeValues: number[];
  awayValues: number[];
  minutesL5: number | null;
  minutesSeason: number | null;
  minutesDirection: "up" | "down" | "steady" | undefined;
  discrete: boolean;
  sampleGames: number;
};

export type PropSimCtxCacheStats = {
  ctxCacheHits: number;
  ctxCacheMisses: number;
  ctxCoalesced: number;
  historyLoads: number;
  distCoalesced: number;
};

export function emptyPropSimCtxCacheStats(): PropSimCtxCacheStats {
  return {
    ctxCacheHits: 0,
    ctxCacheMisses: 0,
    ctxCoalesced: 0,
    historyLoads: 0,
    distCoalesced: 0,
  };
}

export function mergePropSimStats(
  dist: PropDistributionCacheStats,
  ctx: PropSimCtxCacheStats,
): PropDistributionCacheStats & PropSimCtxCacheStats {
  return { ...dist, ...ctx };
}

export function propSimCtxCacheKey(parts: PropSharedDistributionParts): string {
  return propSharedDistributionKey(parts);
}

export function cachedPropSimCtxFromContext(ctx: PropSimulationContext): CachedPropSimCtx {
  const fingerprint = propHistoryFingerprint(ctx);
  return {
    fingerprint,
    recentValues: [...(ctx.recentValues ?? [])],
    vsOpponentValues: [...(ctx.vsOpponentValues ?? [])],
    homeValues: [...(ctx.homeValues ?? [])],
    awayValues: [...(ctx.awayValues ?? [])],
    minutesL5: ctx.minutesL5 ?? null,
    minutesSeason: ctx.minutesSeason ?? null,
    minutesDirection: ctx.minutesDirection,
    discrete: !!ctx.discrete,
    sampleGames: (ctx.recentValues ?? []).filter((v) => Number.isFinite(v)).length,
  };
}

/** Rebuild a full PropSimulationContext for scoring/MC from cached material + live request. */
export function propSimulationContextFromCached(
  cached: CachedPropSimCtx,
  req: {
    sport: string;
    market: string;
    line: number;
    side: "Over" | "Under";
    isHome?: boolean | null;
    additionalLines?: number[];
  },
  game: {
    oppPace?: number | null;
    leaguePace?: number | null;
    oppKeyInjuries?: number;
    ownKeyInjuries?: number;
    weatherImpact?: number | null;
  },
): PropSimulationContext {
  return {
    sport: req.sport,
    market: req.market,
    line: req.line,
    side: req.side,
    recentValues: [...cached.recentValues],
    vsOpponentValues: [...cached.vsOpponentValues],
    homeValues: [...cached.homeValues],
    awayValues: [...cached.awayValues],
    isHome: req.isHome ?? null,
    minutesL5: cached.minutesL5,
    minutesSeason: cached.minutesSeason,
    minutesDirection: cached.minutesDirection,
    oppPace: game.oppPace ?? null,
    leaguePace: game.leaguePace ?? null,
    oppKeyInjuries: game.oppKeyInjuries ?? 0,
    ownKeyInjuries: game.ownKeyInjuries ?? 0,
    weatherImpact: game.weatherImpact ?? null,
    discrete: cached.discrete,
    additionalLines: req.additionalLines,
  };
}

export async function getCachedPropSimCtx(
  parts: PropSharedDistributionParts,
): Promise<CachedPropSimCtx | undefined> {
  return getPropSimCtxStore<CachedPropSimCtx>(propSimCtxCacheKey(parts));
}

export async function setCachedPropSimCtx(
  parts: PropSharedDistributionParts,
  value: CachedPropSimCtx,
): Promise<void> {
  await setPropSimCtxStore(propSimCtxCacheKey(parts), value, PROPSIM_CTX_TTL_MS);
}

export async function withPropSimCtxInflight<T>(
  parts: PropSharedDistributionParts,
  work: () => Promise<T>,
): Promise<{ value: T; coalesced: boolean }> {
  return withInflightCoalesce(`ctx:${propSimCtxCacheKey(parts)}`, work);
}

/** Run async work over items with bounded concurrency (no unbounded Promise.all). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}
