/**
 * Phase 2.2 — dedicated athlete-identity store.
 * Isolated from the shared odds/props/history CACHE_MAX=200 LRU so identity
 * bindings are not evicted by high-churn board traffic.
 *
 * Redis when REDIS_URL is set; otherwise uncapped TTL Map.
 */

import { cacheGet, cacheSet, redisEnabled } from "./store.js";
import { normalizePlayerName } from "./espnRoster.js";

type MemEntry = { value: string; expiresAt: number };

const identityMem = new Map<string, MemEntry>();
const PREFIX = "athlete-id:";

/** Conservative stable TTL (audited 24h–7d range). */
export const ATHLETE_IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;

/** Bounded concurrency for cold identity misses (bench: 4 near-optimal). */
export const ATHLETE_IDENTITY_CONCURRENCY = 4;

/**
 * Canonical identity key: sport | normalizedPlayerName | ESPNTeamId
 * Sport is required — same name in different sports must not collide.
 * Empty teamId is allowed when the player's team is unknown (still sport-scoped).
 */
export function athleteIdentityKey(
  sport: string,
  player: string,
  teamId: string | null | undefined,
): string {
  const s = String(sport ?? "")
    .trim()
    .toLowerCase();
  const name = normalizePlayerName(String(player ?? ""));
  const team = String(teamId ?? "").trim();
  return `${s}|${name}|${team}`;
}

function memGet(key: string): string | undefined {
  const hit = identityMem.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    identityMem.delete(key);
    return undefined;
  }
  identityMem.delete(key);
  identityMem.set(key, hit);
  return hit.value;
}

function memSet(key: string, value: string, ttlMs: number): void {
  identityMem.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
}

export async function getAthleteIdentity(key: string): Promise<string | undefined> {
  const full = `${PREFIX}${key}`;
  if (redisEnabled()) {
    const fromRedis = await cacheGet<string>(full);
    if (typeof fromRedis === "string" && fromRedis.length > 0) return fromRedis;
  }
  return memGet(full);
}

/**
 * Persist a positive ESPN athlete id only. Never store null/empty — a rejected
 * lookup must not poison later requests.
 */
export async function setAthleteIdentity(
  key: string,
  athleteId: string,
  ttlMs: number = ATHLETE_IDENTITY_TTL_MS,
): Promise<void> {
  const id = String(athleteId ?? "").trim();
  if (!id) return;
  const full = `${PREFIX}${key}`;
  memSet(full, id, ttlMs);
  if (redisEnabled()) {
    await cacheSet(full, id, ttlMs);
  }
}

/** Test helpers */
export function clearAthleteIdentityStoreForTests(): void {
  identityMem.clear();
}

export function athleteIdentityStoreStatsForTests() {
  return {
    entries: identityMem.size,
    redis: redisEnabled(),
    ttlMs: ATHLETE_IDENTITY_TTL_MS,
  };
}
