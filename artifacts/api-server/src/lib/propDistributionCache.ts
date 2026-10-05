/**
 * Phase 1: cache the underlying 10k prop-stat draw (line/side/odds free).
 * Thresholds/O-U/American odds are evaluated later against these samples.
 */

import { createHash } from "node:crypto";

import type { PropSimulationContext } from "./monteCarlo.js";
import type { SimTier } from "./simCache.js";
import {
  propSharedDistributionKey,
  type PropSharedDistributionParts,
} from "./propSharedDistribution.js";
import {
  getPropSimDistStore,
  setPropSimDistStore,
  withInflightCoalesce,
} from "./propSimDedicatedStore.js";

/** Deep / quick TTLs — dedicated store (not shared CACHE_MAX=200 LRU). */
const DIST_TTL_MS: Record<SimTier, number> = {
  quick: 5 * 60_000,
  deep: 30 * 60_000,
};

export type CachedPropDistribution = {
  /** Line-agnostic identity (no sportsbook / odds / O-U / threshold). */
  distributionKey: string;
  tier: SimTier;
  simulations: number;
  samples: number[];
  meanProjection: number;
  medianProjection: number;
  mostLikelyLine: number | null;
  stdDev: number;
  sampleGames: number;
  percentiles: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  /** Context needed to recompute confidence without redrawing. */
  vsOpponentCount: number;
  minutesL5: number | null;
  minutesSeason: number | null;
  oppPace: number | null;
};

export type PropDistributionCacheStats = {
  distributionCacheHits: number;
  distributionCacheMisses: number;
  distributionsGenerated: number;
  thresholdsEvaluatedFromCache: number;
  thresholdsEvaluatedFromFreshDraw: number;
  monteCarloDrawsAvoided: number;
  monteCarloDrawsExecuted: number;
  /** Phase 2.1 instrumentation */
  ctxCacheHits: number;
  ctxCacheMisses: number;
  ctxCoalesced: number;
  historyLoads: number;
  distCoalesced: number;
};

export function emptyPropDistributionCacheStats(): PropDistributionCacheStats {
  return {
    distributionCacheHits: 0,
    distributionCacheMisses: 0,
    distributionsGenerated: 0,
    thresholdsEvaluatedFromCache: 0,
    thresholdsEvaluatedFromFreshDraw: 0,
    monteCarloDrawsAvoided: 0,
    monteCarloDrawsExecuted: 0,
    ctxCacheHits: 0,
    ctxCacheMisses: 0,
    ctxCoalesced: 0,
    historyLoads: 0,
    distCoalesced: 0,
  };
}

/** Fingerprint of history/form series that feed the draw. */
export function propHistoryFingerprint(
  ctx: Pick<
    PropSimulationContext,
    | "recentValues"
    | "vsOpponentValues"
    | "homeValues"
    | "awayValues"
    | "minutesL5"
    | "minutesSeason"
    | "minutesDirection"
    | "discrete"
  >,
): string {
  const pack = (xs: number[] | undefined) =>
    (xs ?? [])
      .filter((n) => Number.isFinite(n))
      .map((n) => Number(n).toFixed(3))
      .join(",");
  const raw = [
    pack(ctx.recentValues),
    pack(ctx.vsOpponentValues),
    pack(ctx.homeValues),
    pack(ctx.awayValues),
    ctx.minutesL5 != null ? Number(ctx.minutesL5).toFixed(2) : "",
    ctx.minutesSeason != null ? Number(ctx.minutesSeason).toFixed(2) : "",
    ctx.minutesDirection ?? "",
    ctx.discrete ? "1" : "0",
  ].join(";");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

/**
 * Cache key for the underlying distribution.
 * Must NOT include sportsbook, American odds, Over/Under, or threshold.
 */
export function propDistributionCacheKey(
  parts: PropSharedDistributionParts,
  historyFingerprint: string,
  tier: SimTier,
  simulations: number,
): string {
  const base = propSharedDistributionKey(parts);
  return `simdist:${tier}:${simulations}:${historyFingerprint}:${base}`;
}

export async function getCachedPropDistribution(
  key: string,
): Promise<CachedPropDistribution | undefined> {
  return getPropSimDistStore<CachedPropDistribution>(key);
}

export async function setCachedPropDistribution(
  key: string,
  value: CachedPropDistribution,
  tier: SimTier,
): Promise<void> {
  await setPropSimDistStore(key, value, DIST_TTL_MS[tier]);
}

/** Coalesce concurrent distribution generations for the same distKey. */
export async function withPropSimDistInflight<T>(
  distKey: string,
  work: () => Promise<T>,
): Promise<{ value: T; coalesced: boolean }> {
  return withInflightCoalesce(`dist:${distKey}`, work);
}
