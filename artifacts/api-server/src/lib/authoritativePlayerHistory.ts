/**
 * Phase 2.3 — authoritative player history shared by propsim-ctx and Coach enrich.
 *
 * Field map (share only semantically identical material):
 *
 * | field                    | propsim | enrich/grading | shareable? |
 * |--------------------------|---------|----------------|------------|
 * | sport                    | yes     | yes            | yes (identity) |
 * | athleteId                | yes     | yes            | yes (identity) |
 * | labels                   | yes     | yes            | yes |
 * | recent[].stats           | yes     | yes            | yes |
 * | recent[].isHome          | yes     | yes            | yes |
 * | recent[].opponentId      | yes     | yes            | yes |
 * | recent[].date            | no*     | yes            | enrich-only projection from same games |
 * | recent[].opponentName    | no*     | yes            | enrich-only projection from same games |
 * | vsOpponent[].stats       | yes     | yes            | yes |
 * | vsOpponent[].date        | no*     | yes            | enrich-only from same games |
 * | homeSplit / awaySplit    | derived | API consumers  | yes (same aggregates) |
 * | minutesTrend             | unused† | yes            | enrich-only (†propsim shape historically omitted it — keep MC identical) |
 * | windows / seasonSummary  | no      | API-only       | enrich-route-only (not board enrich slice) |
 * | oppPace / injuries / wx  | game ctx| separate        | NOT history — do not mix into this store |
 * | history fingerprint      | yes     | no             | propsim-only (derived from shared recent values) |
 *
 * *Propsim `PlayerHistoryShape` historically strips date/opponentName; MC uses
 * stats/isHome/opponentId only. Enrichment projects date/opp from the same
 * authoritative games so grading receives identical material as `/sports/player-history`.
 *
 * Freshness: 30m TTL — matches ESPN `cachedJson` and client `COACH_CONTEXT_TTL_MS.playerHistory`.
 * Never reuse across wrong player/sport. Opponent filter applied at read time.
 */

import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";
import type { PlayerHistoryShape } from "./monteCarloBuild.js";
import { withInflightCoalesce } from "./propSimDedicatedStore.js";

export const AUTHORITATIVE_PLAYER_HISTORY_TTL_MS = 30 * 60_000;

type GameLog = {
  events?: Record<
    string,
    { opponent?: { id?: string; displayName?: string }; gameDate?: string; atVs?: string }
  >;
  seasonTypes?: Array<{
    categories?: Array<{
      events?: Array<{ eventId?: string; stats?: string[] }>;
    }>;
  }>;
  names?: string[];
  labels?: string[];
};

export type AuthoritativeFlatGame = {
  eventId: string;
  date: string | null;
  opponentId: string | null;
  opponentName: string | null;
  isHome: boolean | null;
  stats: Record<string, string>;
};

export type AuthoritativePlayerHistory = {
  sport: string;
  athleteId: string;
  labels: string[];
  flat: AuthoritativeFlatGame[];
  loadedAtMs: number;
};

/** Wire payload returned to Coach enrich (matches getPlayerHistory material used by enrich). */
export type PropSimEnrichmentHistory = {
  sport: string;
  athleteId: string;
  labels: string[];
  recent: Array<{
    date: string | null;
    opponentName: string | null;
    opponentId: string | null;
    isHome: boolean | null;
    stats: Record<string, string>;
  }>;
  vsOpponent: Array<{
    date: string | null;
    stats: Record<string, string>;
  }>;
  minutesTrend: {
    l5: number | null;
    l10: number | null;
    season: number | null;
    direction: "up" | "down" | "steady";
  } | null;
};

type MemEntry = { value: AuthoritativePlayerHistory; expiresAt: number };

const histMem = new Map<string, MemEntry>();

export function authoritativePlayerHistoryKey(sport: string, athleteId: string): string {
  return `auth-hist:${String(sport).toLowerCase()}:${String(athleteId)}`;
}

function memGet(key: string): AuthoritativePlayerHistory | undefined {
  const hit = histMem.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    histMem.delete(key);
    return undefined;
  }
  return hit.value;
}

function memSet(key: string, value: AuthoritativePlayerHistory): void {
  histMem.set(key, {
    value,
    expiresAt: Date.now() + AUTHORITATIVE_PLAYER_HISTORY_TTL_MS,
  });
}

function flattenGameLog(log: GameLog): { labels: string[]; flat: AuthoritativeFlatGame[] } {
  const labels = (log.labels ?? log.names ?? []) as string[];
  const names = (log.names ?? []) as string[];
  const eventMeta = log.events ?? {};
  const flat: AuthoritativeFlatGame[] = [];
  for (const st of log.seasonTypes ?? []) {
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (!ev.eventId) continue;
        const meta = eventMeta[ev.eventId];
        const stats: Record<string, string> = {};
        (ev.stats ?? []).forEach((v, i) => {
          if (labels[i]) stats[labels[i]] = v;
          if (names[i]) stats[names[i]] = v;
        });
        const atVs = meta?.atVs;
        const isHome = atVs === "vs" ? true : atVs === "@" ? false : null;
        flat.push({
          eventId: ev.eventId,
          date: meta?.gameDate ?? null,
          opponentId: meta?.opponent?.id ?? null,
          opponentName: meta?.opponent?.displayName ?? null,
          isHome,
          stats,
        });
      }
    }
  }
  flat.sort((a, b) => {
    const ad = a.date ? new Date(a.date).getTime() : 0;
    const bd = b.date ? new Date(b.date).getTime() : 0;
    return bd - ad;
  });
  return { labels, flat };
}

async function fetchAndCacheAuthoritative(
  sport: string,
  athleteId: string,
): Promise<AuthoritativePlayerHistory | null> {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path || !athleteId) return null;
  const key = `player-history:${path}:${athleteId}:current`;
  const log = await cachedJson<GameLog>(key, AUTHORITATIVE_PLAYER_HISTORY_TTL_MS, async () => {
    const url = `https://site.web.api.espn.com/apis/common/v3/sports/${path}/athletes/${athleteId}/gamelog`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ESPN gamelog ${r.status}`);
    return (await r.json()) as GameLog;
  });
  const { labels, flat } = flattenGameLog(log);
  if (!flat.length) return null;
  return {
    sport,
    athleteId,
    labels,
    flat,
    loadedAtMs: Date.now(),
  };
}

/**
 * Load authoritative history once per sport|athleteId.
 * Concurrent propsim + /sports/player-history / enrich consumers coalesce.
 * In-flight entry cleared on success and failure.
 */
export async function loadAuthoritativePlayerHistory(
  sport: string,
  athleteId: string,
): Promise<{ history: AuthoritativePlayerHistory | null; coalesced: boolean }> {
  const sportKey = String(sport || "").toLowerCase();
  const id = String(athleteId || "").trim();
  if (!sportKey || !id || !ESPN_SPORT_PATHS[sportKey]) {
    return { history: null, coalesced: false };
  }
  const storeKey = authoritativePlayerHistoryKey(sportKey, id);
  const cached = memGet(storeKey);
  if (cached) return { history: cached, coalesced: false };

  const { value, coalesced } = await withInflightCoalesce(storeKey, async () => {
    const again = memGet(storeKey);
    if (again) return again;
    try {
      const loaded = await fetchAndCacheAuthoritative(sportKey, id);
      if (loaded) memSet(storeKey, loaded);
      return loaded;
    } catch {
      return null;
    }
  });
  return { history: value, coalesced };
}

/** Peek warm authoritative history without fetching. */
export function peekAuthoritativePlayerHistory(
  sport: string,
  athleteId: string,
): AuthoritativePlayerHistory | undefined {
  return memGet(authoritativePlayerHistoryKey(String(sport).toLowerCase(), String(athleteId)));
}

/**
 * Propsim shape — identical fields to legacy fetchEspnPlayerHistory
 * (no date/opponentName/minutesTrend) so MC equations stay unchanged.
 */
export function toPropSimHistoryShape(
  auth: AuthoritativePlayerHistory,
  opponentTeamId?: string,
): PlayerHistoryShape {
  const recent = auth.flat.slice(0, 10);
  const vsOpponent = opponentTeamId
    ? auth.flat.filter((g) => g.opponentId === opponentTeamId).slice(0, 10)
    : [];
  const homeGames = recent.filter((g) => g.isHome === true);
  const awayGames = recent.filter((g) => g.isHome === false);
  const sumStats = (games: AuthoritativeFlatGame[]) => {
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const g of games) {
      for (const [lab, raw] of Object.entries(g.stats)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        sums[lab] = (sums[lab] ?? 0) + n;
        counts[lab] = (counts[lab] ?? 0) + 1;
      }
    }
    const averages: Record<string, number> = {};
    for (const lab of Object.keys(sums)) {
      averages[lab] = Math.round((sums[lab]! / counts[lab]!) * 100) / 100;
    }
    return { games: games.length, averages };
  };
  return {
    labels: auth.labels,
    recent: recent.map((g) => ({
      stats: g.stats,
      isHome: g.isHome,
      opponentId: g.opponentId,
    })),
    vsOpponent: vsOpponent.map((g) => ({ stats: g.stats })),
    homeSplit: sumStats(homeGames),
    awaySplit: sumStats(awayGames),
  };
}

function minutesTrendFromAuth(
  sport: string,
  labels: string[],
  flat: AuthoritativeFlatGame[],
): PropSimEnrichmentHistory["minutesTrend"] {
  if ((sport !== "nba" && sport !== "wnba") || !labels.includes("MIN")) return null;
  const avgMin = (games: AuthoritativeFlatGame[]) => {
    const vals = games
      .map((g) => Number(g.stats.MIN))
      .filter((n) => Number.isFinite(n));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  };
  const l5 = avgMin(flat.slice(0, 5));
  const l10 = avgMin(flat.slice(0, 10));
  const season = avgMin(flat);
  if (l5 == null && l10 == null && season == null) return null;
  let direction: "up" | "down" | "steady" = "steady";
  if (l5 != null && season != null) {
    if (l5 >= season + 2) direction = "up";
    else if (l5 <= season - 2) direction = "down";
  }
  return { l5, l10, season, direction };
}

/** Enrichment payload — same material Coach previously got from getPlayerHistory. */
export function toEnrichmentHistory(
  auth: AuthoritativePlayerHistory,
  opponentTeamId?: string,
): PropSimEnrichmentHistory {
  const recent = auth.flat.slice(0, 10);
  const vsOpponent = opponentTeamId
    ? auth.flat.filter((g) => g.opponentId === opponentTeamId).slice(0, 10)
    : [];
  return {
    sport: auth.sport,
    athleteId: auth.athleteId,
    labels: auth.labels,
    recent: recent.map((g) => ({
      date: g.date,
      opponentName: g.opponentName,
      opponentId: g.opponentId,
      isHome: g.isHome,
      stats: g.stats,
    })),
    vsOpponent: vsOpponent.map((g) => ({
      date: g.date,
      stats: g.stats,
    })),
    minutesTrend: minutesTrendFromAuth(auth.sport, auth.labels, auth.flat),
  };
}

export function clearAuthoritativePlayerHistoryForTests(): void {
  histMem.clear();
}

export function authoritativePlayerHistoryStatsForTests() {
  return { entries: histMem.size };
}
