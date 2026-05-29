// An app "sport" can map to a single Odds API sport key (most sports) OR to
// MULTIPLE keys that are fetched and merged under one tab:
//   - soccer  → several live leagues (the API has no single "all soccer" key)
//   - tennis  → ATP + WTA draws of the active major
// odds.ts normalizes this to an array, fetches each key, and tags every
// returned event with its own sport_key so per-event (alt/period) fetches and
// caches stay keyed to the correct league/tour.
export const ODDS_SPORT_KEYS: Record<string, string | string[]> = {
  nfl: "americanfootball_nfl",
  nba: "basketball_nba",
  wnba: "basketball_wnba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  soccer: [
    "soccer_uefa_champs_league",
    "soccer_france_ligue_one",
    "soccer_brazil_campeonato",
    "soccer_japan_j_league",
    "soccer_italy_serie_b",
    "soccer_spain_segunda_division",
  ],
  ncaaf: "americanfootball_ncaaf",
  ncaab: "basketball_ncaab",
  ufc: "mma_mixed_martial_arts",
  tennis: ["tennis_atp_french_open", "tennis_wta_french_open"],
};

export const ESPN_SPORT_PATHS: Record<string, string> = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  wnba: "basketball/wnba",
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
