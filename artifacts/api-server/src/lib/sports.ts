export const ODDS_SPORT_KEYS: Record<string, string> = {
  nfl: "americanfootball_nfl",
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  soccer: "soccer_uefa_champs_league",
  ncaaf: "americanfootball_ncaaf",
  ncaab: "basketball_ncaab",
  ufc: "mma_mixed_martial_arts",
};

export const ESPN_SPORT_PATHS: Record<string, string> = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  soccer: "soccer/uefa.champions",
  ncaaf: "football/college-football",
  ncaab: "basketball/mens-college-basketball",
  ufc: "mma/ufc",
};

type CacheEntry = { value: unknown; expiresAt: number };
const CACHE_MAX = 200;
const cache = new Map<string, CacheEntry>();

export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    // refresh LRU ordering
    cache.delete(key);
    cache.set(key, hit);
    return hit.value as T;
  }
  const value = await fetcher();
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

// Simple per-IP sliding-window rate limiter for expensive routes.
const rlBuckets = new Map<string, number[]>();
const RL_MAX_KEYS = 5000;
export function rateLimit(opts: { windowMs: number; max: number }) {
  return (req: { ip?: string; socket?: { remoteAddress?: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const arr = (rlBuckets.get(ip) || []).filter((t) => now - t < opts.windowMs);
    if (arr.length >= opts.max) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    arr.push(now);
    if (rlBuckets.size >= RL_MAX_KEYS) {
      const oldest = rlBuckets.keys().next().value;
      if (oldest !== undefined) rlBuckets.delete(oldest);
    }
    rlBuckets.set(ip, arr);
    next();
  };
}
