/**
 * Phase 2.1 — dedicated prop-sim stores (ctx + distributions).
 * Separate from the shared odds/history CACHE_MAX=200 LRU so 73KB simdists
 * and small ctx fingerprints cannot thrash each other.
 *
 * Redis is used when REDIS_URL is set (multi-instance). Otherwise uncapped
 * TTL Maps (entries expire on read / periodic prune).
 */

import { cacheGet, cacheSet, redisEnabled } from "./store.js";

type MemEntry = { value: unknown; expiresAt: number };

const ctxMem = new Map<string, MemEntry>();
const distMem = new Map<string, MemEntry>();
const inflight = new Map<string, Promise<unknown>>();

const CTX_PREFIX = "propsim-ctx:";
const DIST_PREFIX = "propsim-dist:";

function memGet<T>(map: Map<string, MemEntry>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    map.delete(key);
    return undefined;
  }
  // refresh LRU-ish order without size cap
  map.delete(key);
  map.set(key, hit);
  return hit.value as T;
}

function memSet(map: Map<string, MemEntry>, key: string, value: unknown, ttlMs: number): void {
  map.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
}

async function dedicatedGet<T>(
  map: Map<string, MemEntry>,
  prefix: string,
  key: string,
): Promise<T | undefined> {
  const full = `${prefix}${key}`;
  if (redisEnabled()) {
    const fromRedis = await cacheGet<T>(full);
    if (fromRedis !== undefined) return fromRedis;
  }
  return memGet<T>(map, full);
}

async function dedicatedSet(
  map: Map<string, MemEntry>,
  prefix: string,
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  const full = `${prefix}${key}`;
  memSet(map, full, value, ttlMs);
  if (redisEnabled()) {
    await cacheSet(full, value, ttlMs);
  }
}

export async function getPropSimCtxStore<T>(key: string): Promise<T | undefined> {
  return dedicatedGet<T>(ctxMem, CTX_PREFIX, key);
}

export async function setPropSimCtxStore(
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  await dedicatedSet(ctxMem, CTX_PREFIX, key, value, ttlMs);
}

export async function getPropSimDistStore<T>(key: string): Promise<T | undefined> {
  return dedicatedGet<T>(distMem, DIST_PREFIX, key);
}

export async function setPropSimDistStore(
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  await dedicatedSet(distMem, DIST_PREFIX, key, value, ttlMs);
}

/**
 * In-flight Promise coalesce. One underlying task per key; waiters share it.
 * Entry is registered before work starts and always cleared on settle
 * (success or failure) so rejects / sync throws cannot poison future calls.
 * Replaces the old deepInFlight Set-skip that could permanently suppress work.
 */
export async function withInflightCoalesce<T>(
  key: string,
  work: () => Promise<T>,
): Promise<{ value: T; coalesced: boolean }> {
  const existing = inflight.get(key);
  if (existing) {
    return { value: (await existing) as T, coalesced: true };
  }
  // Register before scheduling work so concurrent callers always coalesce.
  const promise = Promise.resolve().then(() => work());
  inflight.set(key, promise);
  try {
    return { value: (await promise) as T, coalesced: false };
  } finally {
    if (inflight.get(key) === promise) inflight.delete(key);
  }
}

/** Test helpers */
export function clearPropSimDedicatedStoresForTests(): void {
  ctxMem.clear();
  distMem.clear();
  inflight.clear();
}

/** Clear only distributions — leave propsim-ctx warm (bench: warm ctx + cold dist). */
export function clearPropSimDistStoreForTests(): void {
  distMem.clear();
  for (const key of [...inflight.keys()]) {
    if (key.startsWith("dist:")) inflight.delete(key);
  }
}

export function propSimDedicatedStoreStatsForTests() {
  return {
    ctxEntries: ctxMem.size,
    distEntries: distMem.size,
    inflight: inflight.size,
    redis: redisEnabled(),
  };
}
