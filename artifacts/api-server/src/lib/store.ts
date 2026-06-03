// Shared store for cache + rate-limit state.
//
// In a single-instance deployment everything lives in-process (Maps). To run
// MULTIPLE server instances behind a load balancer, set REDIS_URL — cache
// entries and rate-limit buckets then live in Redis so every instance shares
// the same view (a per-IP/per-user limit stays a single limit no matter which
// instance serves the request, and a cached odds payload is reused across all
// instances instead of each one re-hitting the paid upstream).
//
// Redis is OPTIONAL. With no REDIS_URL the code behaves exactly as before. Any
// Redis error fails OPEN (cache miss / allow the request) so a Redis hiccup can
// never take the API down — at worst we briefly fall back to per-instance state.
import Redis from "ioredis";
import { logger } from "./logger";

let redisClient: Redis | null | undefined; // undefined = not yet initialized

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    redisClient = null;
    return null;
  }
  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      // Cap reconnection backoff so a down Redis doesn't spin hot.
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
    client.on("error", (err: Error) => {
      logger.warn({ err: err?.message }, "redis error (store fails open)");
    });
    client.on("connect", () => logger.info("redis store connected"));
    redisClient = client;
    logger.info("redis store enabled (shared cache + rate limits)");
    return client;
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message },
      "redis init failed; using in-memory store",
    );
    redisClient = null;
    return null;
  }
}

export function redisEnabled(): boolean {
  return getRedis() !== null;
}

// ---------------------------------------------------------------------------
// Cache (JSON value + TTL)
// ---------------------------------------------------------------------------
type CacheEntry = { value: unknown; expiresAt: number };
const CACHE_MAX = 200;
const memCache = new Map<string, CacheEntry>();

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(`cache:${key}`);
      if (raw == null) return undefined;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "redis cacheGet failed; falling back to in-memory cache",
      );
      // fall through to the in-memory path (degraded, per-instance)
    }
  }
  const now = Date.now();
  const hit = memCache.get(key);
  if (hit && hit.expiresAt > now) {
    // refresh LRU ordering
    memCache.delete(key);
    memCache.set(key, hit);
    return hit.value as T;
  }
  return undefined;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlMs: number,
): Promise<void> {
  if (value === undefined) return; // can't serialize; treat as uncacheable
  const r = getRedis();
  if (r) {
    try {
      await r.set(`cache:${key}`, JSON.stringify(value), "PX", ttlMs);
      return;
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "redis cacheSet failed; falling back to in-memory cache",
      );
      // fall through to the in-memory path (degraded, per-instance)
    }
  }
  if (memCache.size >= CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window)
// ---------------------------------------------------------------------------
// Atomic sliding-window counter in Redis: drop expired members, count, and only
// then admit (matching the in-memory semantics — up to `max` per window, the
// (max+1)-th is rejected WITHOUT consuming a slot). Returns 1 when limited.
const RL_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= max then
  return 1
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return 0
`;

const rlMem = new Map<string, number[]>();
const RL_MAX_KEYS = 5000;

// Returns true when the request should be rejected (limit exceeded).
export async function rateLimitHit(
  bucketKey: string,
  windowMs: number,
  max: number,
): Promise<boolean> {
  const now = Date.now();
  const r = getRedis();
  if (r) {
    try {
      const member = `${now}-${Math.random().toString(36).slice(2)}`;
      const limited = (await r.eval(
        RL_LUA,
        1,
        `rl:${bucketKey}`,
        String(now),
        String(windowMs),
        String(max),
        member,
      )) as number;
      return limited === 1;
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "redis rateLimit failed; falling back to in-memory limiter",
      );
      // fall through to the in-memory limiter (degraded, per-instance) rather
      // than disabling rate limiting entirely during a Redis outage.
    }
  }
  const arr = (rlMem.get(bucketKey) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    rlMem.set(bucketKey, arr);
    return true;
  }
  arr.push(now);
  if (rlMem.size >= RL_MAX_KEYS) {
    const oldest = rlMem.keys().next().value;
    if (oldest !== undefined) rlMem.delete(oldest);
  }
  rlMem.set(bucketKey, arr);
  return false;
}
