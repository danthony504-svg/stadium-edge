import { scoringSignalKey, type FootballTdSignal } from "./footballScoringOpportunities.js";
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
import {
  lookupOpportunityShift,
  type OpportunityShiftTable,
} from "./opportunityShift/index.js";
import { buildPreSimShiftFactors } from "./preSimShift/index.js";

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
  /** Full-season (or best available) baseline for venue/matchup ratios. */
  seasonValues?: number[];
  vsOpponentValues: number[];
  homeValues: number[];
  awayValues: number[];
  recentHomeValues?: number[];
  recentAwayValues?: number[];
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
    // home/away on ctx are full-season venue series after wiring; season baseline
    // falls back to recent when seasonGames were unavailable.
    seasonValues: [
      ...(ctx.homeValues ?? []),
      ...(ctx.awayValues ?? []),
    ],
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
    player?: string;
    athleteId?: string | null;
    playerTeamId?: string | null;
    opponentTeamId?: string | null;
  },
  game: {
    footballTdSignals?: Record<string, FootballTdSignal>;
    oppPace?: number | null;
    leaguePace?: number | null;
    oppKeyInjuries?: number;
    ownKeyInjuries?: number;
    weatherImpact?: number | null;
    opportunityShift?: OpportunityShiftTable | null;
    defenseIndex?: number | null;
    defenseIndexByFamily?: Record<string, number> | null;
    coupledReceivingMatchupByTeam?: Map<string, number> | null;
  },
): PropSimulationContext {
  const opp = lookupOpportunityShift(game.opportunityShift, {
    player: req.player ?? "",
    athleteId: req.athleteId,
    market: req.market,
    sport: req.sport,
  });
  const sideKey =
    req.isHome === true ? "home" : req.isHome === false ? "away" : "";
  const coupledReceiving =
    (sideKey && game.coupledReceivingMatchupByTeam?.get(sideKey)) || null;
  const family = opp.family;
  const defenseIndex =
    (family && game.defenseIndexByFamily?.[family]) ?? game.defenseIndex ?? null;
  const seasonValues =
    cached.seasonValues?.length ? cached.seasonValues : cached.recentValues;
  const recentVenue =
    req.isHome === true
      ? cached.recentHomeValues ?? []
      : req.isHome === false
        ? cached.recentAwayValues ?? []
        : [];
  const pre = buildPreSimShiftFactors({
    sport: req.sport,
    market: req.market,
    isHome: req.isHome,
    seasonValues,
    homeValues: cached.homeValues,
    awayValues: cached.awayValues,
    vsOpponentValues: cached.vsOpponentValues,
    recentVenueValues: recentVenue,
    opportunityShift: opp.multiplier,
    opportunityExplain: opp.explanation,
    opportunityFamily: opp.family,
    defenseIndex,
    coupledReceivingMatchup: coupledReceiving,
  });
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
    footballTdSignal: game.footballTdSignals?.[scoringSignalKey(req)] ?? null,
    discrete: cached.discrete,
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
