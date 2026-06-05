import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { cacheGet, cacheSet, rateLimitHit } from "./store.js";

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
    "soccer_fifa_world_cup",
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

// Cache is backed by the shared store (in-memory by default; Redis when
// REDIS_URL is set so multiple instances share one cache). cachedJson keeps the
// fetch-on-miss contract callers already rely on.
export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await fetcher();
  await cacheSet(key, value, ttlMs);
  return value;
}

// Sliding-window rate limiter for expensive routes.
//
// Identity: a signed-in user is keyed by their Clerk user id (stable and
// unspoofable); anonymous traffic falls back to the real client IP. The real IP
// is only available because app.ts sets `trust proxy` — otherwise every request
// behind Replit's proxy shares one socket IP and the limit would be GLOBAL
// rather than per-user.
//
// The bucket key is also scoped per-limiter — otherwise one global per-identity
// bucket would be shared across ALL limited routes (odds, props, chat, ...) and
// unrelated traffic would throttle the odds fallbacks, falsely thinning the pool.
//
// State lives in the shared store, so the limit holds across instances when
// Redis is configured. `name` MUST be a stable, unique label per limiter (e.g.
// "odds", "chat") — it becomes the Redis bucket scope, so every instance and
// every rollout must agree on it. (Ordinal/auto-generated scopes would diverge
// across mixed-version deployments and fragment the shared buckets.)
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const scope = opts.name;
  return (req: Request, res: Response, next: NextFunction): void => {
    let identity = "";
    try {
      const auth = getAuth(req);
      if (auth?.userId) identity = `u:${auth.userId}`;
    } catch {
      // getAuth throws if clerkMiddleware hasn't run for this request; ignore
      // and fall back to IP-based keying.
    }
    if (!identity) {
      identity = `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
    }
    const bucketKey = `${scope}:${identity}`;
    rateLimitHit(bucketKey, opts.windowMs, opts.max)
      .then((limited) => {
        if (limited) {
          res.status(429).json({ error: "Too many requests" });
          return;
        }
        next();
      })
      .catch(() => next()); // fail open — never block traffic on store errors
  };
}
