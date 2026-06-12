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
  // Fallback only — tennis keys are resolved dynamically (see resolveOddsKeys).
  // The Odds API has a separate key per tournament, so a hardcoded major goes
  // empty the moment that major ends.
  tennis: ["tennis_atp_french_open", "tennis_wta_french_open"],
};

// Resolve the Odds API sport key(s) to fetch for an app sport.
//
// Most sports map to a fixed key (or a fixed set). TENNIS is different: the Odds
// API has a SEPARATE key per tournament (tennis_atp_french_open,
// tennis_wta_wimbledon, tennis_wta_queens_club_champ, ...) and only the events
// currently being played are flagged `active`. Pinning the tab to one major's
// keys means it goes empty the moment that major ends (e.g. after Roland-Garros
// the live grass-court events live under entirely different keys). So for tennis
// we discover the active ATP/WTA tournament keys from the Odds API sports list
// (cached 30 min) and fetch those, keeping the tab in step with the live
// calendar. Fail-safe: on any error, or if nothing is active, fall back to the
// static keys.
export async function resolveOddsKeys(sportId: string): Promise<string[]> {
  const raw = ODDS_SPORT_KEYS[sportId];
  const staticKeys = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (sportId !== "tennis") return staticKeys;
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) return staticKeys;
  try {
    const list = await cachedJson<Array<{ key?: string; active?: boolean }>>(
      "odds:sportslist:v1",
      30 * 60 * 1000,
      async () => {
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`);
        if (!r.ok) throw new Error(`Odds API sports list ${r.status}`);
        return (await r.json()) as Array<{ key?: string; active?: boolean }>;
      },
    );
    const active = list
      .filter(
        (s) =>
          s.active === true &&
          typeof s.key === "string" &&
          (s.key.startsWith("tennis_atp_") || s.key.startsWith("tennis_wta_")),
      )
      .map((s) => s.key as string);
    return active.length ? active : staticKeys;
  } catch {
    return staticKeys;
  }
}

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
const isLoopback = (addr?: string | null): boolean =>
  addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const scope = opts.name;
  return (req: Request, res: Response, next: NextFunction): void => {
    // Internal server-to-server fallback self-calls (e.g. /sports/odds falling
    // back to /sports/odds-espn during an Odds API credit outage) originate
    // from loopback and must NOT share the per-IP user buckets: under an
    // outage EVERY user request fans out through one loopback IP, which would
    // 429-collapse the fallback right back to the empty result we are trying
    // to avoid. Loopback can't be spoofed from outside — the Replit edge
    // overwrites X-Forwarded-For with the real client IP — and the marker
    // header is only ever set by our own self-calls, so this can never exempt
    // real user traffic.
    if (
      req.headers["x-internal-call"] === "1" &&
      isLoopback(req.socket?.remoteAddress)
    ) {
      next();
      return;
    }
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
