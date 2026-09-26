import type { CoachSimCacheEntry, CoachSimResult } from "@workspace/coach-types";

import type { SimCacheStore } from "./store";

export type SimCacheLookup = {
  result: CoachSimResult;
  cacheHit: boolean;
  entry: CoachSimCacheEntry;
};

export type GetOrSimulateParams = {
  legFingerprint: string;
  contextFingerprint: string;
  simulate: () => Promise<CoachSimResult>;
};

/**
 * Odds-sensitive sim cache. A changed line/price produces a new legFingerprint
 * automatically — no TTL-based stale sims for unchanged odds.
 */
export class CoachSimCache {
  private readonly store: SimCacheStore;

  constructor(store: SimCacheStore) {
    this.store = store;
  }

  async get(legFingerprint: string): Promise<CoachSimCacheEntry | null> {
    return this.store.get(legFingerprint);
  }

  async getOrSimulate(params: GetOrSimulateParams): Promise<SimCacheLookup> {
    const cached = await this.store.get(params.legFingerprint);
    if (cached) {
      return { result: cached.simResult, cacheHit: true, entry: cached };
    }

    const simResult = await params.simulate();
    const entry: CoachSimCacheEntry = {
      legFingerprint: params.legFingerprint,
      contextFingerprint: params.contextFingerprint,
      simResult,
      computedAt: simResult.computedAt,
    };
    await this.store.set(entry);
    return { result: simResult, cacheHit: false, entry };
  }

  stats() {
    return this.store.stats();
  }
}
