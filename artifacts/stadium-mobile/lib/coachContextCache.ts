/**
 * Phase 2 — Coach context TTL cache + in-flight coalescing.
 *
 * Caches stable GET context only (IDs, history, defense, injuries, matchups,
 * period stats). Never caches odds/props/simulate/final picks/grades/EV.
 *
 * TTLs mirror api-server `cachedJson` policies for the same routes.
 */

export type CoachCacheStage =
  | "playerHistory"
  | "injuries"
  | "teamDefense"
  | "matchupHistory"
  | "teamPeriodStats"
  | "teamHistory"
  | "teamSearch"
  | "gameRoster"
  | "espnGames"
  | "otherContext"
  | "gameSimulation";

export type CoachCacheStageStats = {
  stage: CoachCacheStage;
  calls: number;
  cacheHit: number;
  cacheMiss: number;
  coalesced: number;
  durationMs: number;
};

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

type InflightEntry = {
  promise: Promise<unknown>;
};

/** Server-aligned TTLs (see api-server routes). */
export const COACH_CONTEXT_TTL_MS: Record<CoachCacheStage, number> = {
  // espnPlayerHistory.ts — 30 min
  playerHistory: 30 * 60_000,
  // espnInjuries.ts — 10 min
  injuries: 10 * 60_000,
  // defense.ts team-defense — 60 min
  teamDefense: 60 * 60_000,
  // history.ts matchup-history — 15 min
  matchupHistory: 15 * 60_000,
  // teamPeriodStats.ts — 2 h
  teamPeriodStats: 2 * 60 * 60_000,
  // team history / search — slow-changing ESPN metadata
  teamHistory: 60 * 60_000,
  teamSearch: 6 * 60 * 60_000,
  gameRoster: 6 * 60 * 60_000,
  // scoreboard moves; keep short (games list identity for team ids)
  espnGames: 2 * 60_000,
  otherContext: 10 * 60_000,
  // coach game-outcome sim reuse when fingerprint matches
  gameSimulation: 20 * 60_000,
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();
const stats = new Map<CoachCacheStage, CoachCacheStageStats>();

function ensureStats(stage: CoachCacheStage): CoachCacheStageStats {
  let s = stats.get(stage);
  if (!s) {
    s = { stage, calls: 0, cacheHit: 0, cacheMiss: 0, coalesced: 0, durationMs: 0 };
    stats.set(stage, s);
  }
  return s;
}

/** Classify a GET path for context caching. Null = do not cache (live odds/props/sim). */
export function classifyCoachContextPath(path: string): CoachCacheStage | null {
  const p = path.split("?")[0]?.toLowerCase() ?? "";
  if (
    p.includes("/sports/odds") ||
    p.includes("/sports/live-odds") ||
    p.includes("/sports/props") ||
    p.includes("/sports/prizepicks") ||
    p.includes("/sports/simulate/") ||
    p.includes("/sports/espn-odds")
  ) {
    return null;
  }
  if (p.includes("/sports/player-history") || p.includes("/fantasy/nfl-player-history")) {
    return "playerHistory";
  }
  if (p.includes("/sports/injuries")) return "injuries";
  if (p.includes("/sports/team-defense")) return "teamDefense";
  if (p.includes("/sports/matchup-history")) return "matchupHistory";
  if (p.includes("/sports/team-period-stats")) return "teamPeriodStats";
  if (p.includes("/sports/team-history")) return "teamHistory";
  if (p.includes("/sports/team-search") || p.includes("/sports/player-search")) {
    return "teamSearch";
  }
  if (p.includes("/sports/game-roster")) return "gameRoster";
  if (p.includes("/sports/games")) return "espnGames";
  // Weather / mlb context — 10m class
  if (
    p.includes("/sports/weather") ||
    p.includes("/sports/park-weather") ||
    p.includes("/sports/mlb-") ||
    p.includes("/sports/statmuse")
  ) {
    return "otherContext";
  }
  return null;
}

export function coachContextCacheKey(path: string): string {
  return `ctx:${path}`;
}

export function peekCoachContextCache<T>(path: string): T | undefined {
  const key = coachContextCacheKey(path);
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function rememberCoachContextCache(path: string, value: unknown, ttlMs: number): void {
  store.set(coachContextCacheKey(path), {
    value,
    expiresAt: Date.now() + Math.max(0, ttlMs),
  });
}

/**
 * Run `fetcher` with TTL cache + in-flight coalescing for one path.
 * AbortSignal cancels the *waiter* only — shared fetch continues so siblings
 * and the cache still fill.
 */
export async function withCoachContextCache<T>(
  path: string,
  stage: CoachCacheStage,
  fetcher: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const s = ensureStats(stage);
  s.calls += 1;
  const t0 = performance.now();
  const finish = (mode: "hit" | "miss" | "coalesced") => {
    s.durationMs += performance.now() - t0;
    if (mode === "hit") s.cacheHit += 1;
    else if (mode === "coalesced") s.coalesced += 1;
    else s.cacheMiss += 1;
  };

  if (signal?.aborted) throw new Error(`aborted: ${path}`);

  const cached = peekCoachContextCache<T>(path);
  if (cached !== undefined) {
    finish("hit");
    return cached;
  }

  const key = coachContextCacheKey(path);
  const existing = inflight.get(key);
  if (existing) {
    finish("coalesced");
    return (await raceAbort(existing.promise as Promise<T>, signal, path)) as T;
  }

  s.cacheMiss += 1;
  const promise = (async () => {
    try {
      const value = await fetcher();
      rememberCoachContextCache(path, value, COACH_CONTEXT_TTL_MS[stage]);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, { promise });

  try {
    const value = await raceAbort(promise, signal, path);
    s.durationMs += performance.now() - t0;
    return value;
  } catch (e) {
    s.durationMs += performance.now() - t0;
    throw e;
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined, path: string): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new Error(`aborted: ${path}`));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(`aborted: ${path}`));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Game-sim fingerprint cache (separate keyspace). */
const gameSimStore = new Map<string, CacheEntry>();
const gameSimInflight = new Map<string, InflightEntry>();

export function coachGameSimCacheKey(fingerprint: string): string {
  return `gamesim:${fingerprint}`;
}

export function peekCoachGameSimCache<T>(fingerprint: string): T | undefined {
  const key = coachGameSimCacheKey(fingerprint);
  const hit = gameSimStore.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    gameSimStore.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export async function withCoachGameSimCache<T>(
  fingerprint: string,
  fetcher: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const stage: CoachCacheStage = "gameSimulation";
  const s = ensureStats(stage);
  s.calls += 1;
  const t0 = performance.now();

  if (signal?.aborted) throw new Error("aborted: game-sim");

  const cached = peekCoachGameSimCache<T>(fingerprint);
  if (cached !== undefined) {
    s.cacheHit += 1;
    s.durationMs += performance.now() - t0;
    return cached;
  }

  const key = coachGameSimCacheKey(fingerprint);
  const existing = gameSimInflight.get(key);
  if (existing) {
    s.coalesced += 1;
    s.durationMs += performance.now() - t0;
    return raceAbort(existing.promise as Promise<T>, signal, "game-sim");
  }

  s.cacheMiss += 1;
  const promise = (async () => {
    try {
      const value = await fetcher();
      gameSimStore.set(key, {
        value,
        expiresAt: Date.now() + COACH_CONTEXT_TTL_MS.gameSimulation,
      });
      return value;
    } finally {
      gameSimInflight.delete(key);
    }
  })();
  gameSimInflight.set(key, { promise });

  try {
    const value = await raceAbort(promise, signal, "game-sim");
    s.durationMs += performance.now() - t0;
    return value;
  } catch (e) {
    s.durationMs += performance.now() - t0;
    throw e;
  }
}

/**
 * Material game-sim fingerprint — team IDs, sport, cover structure (lines/markets),
 * simulation count. Excludes American odds / sportsbook price.
 */
export function fingerprintCoachGameSim(opts: {
  sport: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeam?: string;
  awayTeam?: string;
  simulations: number;
  coverQueries: Array<{
    id: string;
    kind: string;
    teamSide?: string;
    line?: number;
    totalSide?: string;
    period?: string;
    raceTarget?: number;
  }>;
}): string {
  const covers = [...opts.coverQueries]
    .map((q) =>
      [
        q.id,
        q.kind,
        q.teamSide ?? "",
        q.line ?? "",
        q.totalSide ?? "",
        q.period ?? "",
        q.raceTarget ?? "",
      ].join(":"),
    )
    .sort()
    .join(";");
  return [
    String(opts.sport || "").toLowerCase(),
    opts.homeTeamId ?? "",
    opts.awayTeamId ?? "",
    opts.homeTeam ?? "",
    opts.awayTeam ?? "",
    opts.simulations,
    covers,
  ].join("|");
}

export function getCoachCacheStats(): CoachCacheStageStats[] {
  return [...stats.values()].map((s) => ({
    ...s,
    durationMs: Math.round(s.durationMs),
  }));
}

export function resetCoachCacheStats(): void {
  stats.clear();
}

export function clearCoachContextCache(): void {
  store.clear();
  inflight.clear();
  gameSimStore.clear();
  gameSimInflight.clear();
}

export function coachCacheSnapshot() {
  return {
    stages: getCoachCacheStats(),
    contextEntries: store.size,
    gameSimEntries: gameSimStore.size,
    inflightContext: inflight.size,
    inflightGameSim: gameSimInflight.size,
  };
}
