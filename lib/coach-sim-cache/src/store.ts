import type { CoachSimCacheEntry } from "@workspace/coach-types";

export type SimCacheStats = {
  size: number;
  hits: number;
  misses: number;
};

/** Pluggable sim result storage — Postgres/Redis adapters come in a later phase. */
export interface SimCacheStore {
  get(legFingerprint: string): Promise<CoachSimCacheEntry | null>;
  set(entry: CoachSimCacheEntry): Promise<void>;
  has(legFingerprint: string): Promise<boolean>;
  delete(legFingerprint: string): Promise<boolean>;
  clear(): Promise<void>;
  stats(): SimCacheStats;
}

export class InMemorySimCacheStore implements SimCacheStore {
  private entries = new Map<string, CoachSimCacheEntry>();
  private hits = 0;
  private misses = 0;

  async get(legFingerprint: string): Promise<CoachSimCacheEntry | null> {
    const entry = this.entries.get(legFingerprint) ?? null;
    if (entry) this.hits += 1;
    else this.misses += 1;
    return entry;
  }

  async set(entry: CoachSimCacheEntry): Promise<void> {
    this.entries.set(entry.legFingerprint, entry);
  }

  async has(legFingerprint: string): Promise<boolean> {
    return this.entries.has(legFingerprint);
  }

  async delete(legFingerprint: string): Promise<boolean> {
    return this.entries.delete(legFingerprint);
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): SimCacheStats {
    return { size: this.entries.size, hits: this.hits, misses: this.misses };
  }
}
