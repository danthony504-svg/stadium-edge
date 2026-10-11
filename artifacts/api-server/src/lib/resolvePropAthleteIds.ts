/**
 * Phase 2.2 — athlete identity resolution.
 * Fast path: stamped athleteId (no provider).
 * Miss path: dedicated identity cache → roster → ESPN search,
 * concurrency 4 + in-flight coalesce by canonical identity key.
 * Never fabricates IDs; never caches nulls.
 */

import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";
import { fetchGameRoster, normalizePlayerName } from "./espnRoster.js";
import type { SimPropRequest } from "./monteCarloBuild.js";
import {
  ATHLETE_IDENTITY_CONCURRENCY,
  ATHLETE_IDENTITY_TTL_MS,
  athleteIdentityKey,
  getAthleteIdentity,
  setAthleteIdentity,
} from "./athleteIdentityStore.js";
import { withInflightCoalesce } from "./propSimDedicatedStore.js";
import { mapWithConcurrency } from "./propSimCtxCache.js";
import { stampPropSideContext } from "./propSimSideContext.js";

const LEAGUE_TO_SPORT: Record<string, string> = {
  nba: "nba",
  wnba: "wnba",
  mlb: "mlb",
  nfl: "nfl",
  "college-football": "ncaaf",
  nhl: "nhl",
};

type SearchItem = {
  id?: string;
  displayName?: string;
  league?: string;
  defaultLeagueSlug?: string;
  teamRelationships?: Array<{ displayName?: string }>;
};

/** Sport-scoped search cache key — never read legacy name-only `player-search:` keys. */
export function playerSearchCacheKey(sport: string, query: string): string {
  return `player-search:v2:${String(sport).toLowerCase()}:${query.trim().toLowerCase()}`;
}

async function searchAthleteId(
  sport: string,
  player: string,
  teamTokens: string[],
): Promise<string | null> {
  const query = player.trim();
  if (query.length < 2) return null;
  try {
    const key = playerSearchCacheKey(sport, query);
    const data = await cachedJson<{ items?: SearchItem[] }>(key, 30 * 60 * 1000, async () => {
      const url =
        `https://site.web.api.espn.com/apis/common/v3/search?region=us&lang=en&limit=12&type=player&query=` +
        encodeURIComponent(query);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN search ${r.status}`);
      return (await r.json()) as { items?: SearchItem[] };
    });
    for (const it of data.items ?? []) {
      const leagueSlug = String(it.league || it.defaultLeagueSlug || "").toLowerCase();
      const itemSport = LEAGUE_TO_SPORT[leagueSlug];
      if (itemSport !== sport || !it.id) continue;
      const team = it.teamRelationships?.[0]?.displayName ?? "";
      if (teamTokens.length && team) {
        const teamLower = team.toLowerCase();
        if (!teamTokens.some((tok) => teamLower.includes(tok))) continue;
      }
      return String(it.id);
    }
  } catch {
    /* best-effort — leave unresolved */
  }
  return null;
}

function teamTokens(...names: Array<string | null | undefined>): string[] {
  return names
    .filter(Boolean)
    .map((t) => String(t).trim().split(/\s+/).pop()!.toLowerCase())
    .filter(Boolean);
}

/** Prefer the player's own ESPN team id when home/away/opponent context allows. */
export function derivePlayerTeamId(
  p: Pick<SimPropRequest, "isHome" | "opponentTeamId" | "homeTeamId" | "awayTeamId">,
  homeTeamId: string,
  awayTeamId: string,
): string {
  const home = String(p.homeTeamId ?? homeTeamId ?? "").trim();
  const away = String(p.awayTeamId ?? awayTeamId ?? "").trim();
  if (p.isHome === true && home) return home;
  if (p.isHome === false && away) return away;
  const opp = String(p.opponentTeamId ?? "").trim();
  if (opp && home && away) {
    if (opp === home) return away;
    if (opp === away) return home;
  }
  return "";
}

type ResolveStats = {
  providerCalls: number;
  rosterCalls: number;
  searchCalls: number;
  cacheHits: number;
  cacheMisses: number;
  coalesced: number;
  stampedFastPath: number;
};

export type ResolvePropAthleteIdsResult = {
  props: SimPropRequest[];
  stats: ResolveStats;
};

type UniqueMiss = {
  sport: string;
  player: string;
  preferredTeamId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  coalesceKey: string;
  identityKeysToProbe: string[];
};

function buildUniqueMiss(
  sport: string,
  p: SimPropRequest,
  homeTeamId: string,
  awayTeamId: string,
  homeTeam: string,
  awayTeam: string,
): UniqueMiss {
  const preferredTeamId = derivePlayerTeamId(p, homeTeamId, awayTeamId);
  const identityKeysToProbe = new Set<string>();
  identityKeysToProbe.add(athleteIdentityKey(sport, p.player, preferredTeamId));
  if (homeTeamId) identityKeysToProbe.add(athleteIdentityKey(sport, p.player, homeTeamId));
  if (awayTeamId) identityKeysToProbe.add(athleteIdentityKey(sport, p.player, awayTeamId));

  // Coalesce identical sport+player+team (or same game pair when team unknown).
  const coalesceKey = preferredTeamId
    ? athleteIdentityKey(sport, p.player, preferredTeamId)
    : `${sport}|${normalizePlayerName(p.player)}|${homeTeamId}:${awayTeamId}`;

  return {
    sport,
    player: p.player,
    preferredTeamId,
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
    coalesceKey,
    identityKeysToProbe: [...identityKeysToProbe],
  };
}

/** Resolve missing athleteId via ESPN roster + player search (Simulator parity). */
export async function resolvePropAthleteIds(
  sport: string,
  props: SimPropRequest[],
  opts?: {
    homeTeamId?: string;
    awayTeamId?: string;
    homeTeam?: string;
    awayTeam?: string;
    /** When true, return stats alongside props (tests/benches). */
    withStats?: boolean;
  },
): Promise<SimPropRequest[]> {
  const { props: out } = await resolvePropAthleteIdsDetailed(sport, props, opts);
  return out;
}

export async function resolvePropAthleteIdsDetailed(
  sport: string,
  props: SimPropRequest[],
  opts?: {
    homeTeamId?: string;
    awayTeamId?: string;
    homeTeam?: string;
    awayTeam?: string;
  },
): Promise<ResolvePropAthleteIdsResult> {
  const stats: ResolveStats = {
    providerCalls: 0,
    rosterCalls: 0,
    searchCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    coalesced: 0,
    stampedFastPath: 0,
  };

  if (!ESPN_SPORT_PATHS[sport]) {
    const home = String(opts?.homeTeamId ?? "").trim();
    const away = String(opts?.awayTeamId ?? "").trim();
    return {
      props: props.map((p) =>
        stampPropSideContext(
          { ...p, sport: String(p.sport ?? sport).toLowerCase() },
          home || null,
          away || null,
          p.playerTeamId,
        ),
      ),
      stats,
    };
  }

  const defaultHome = String(opts?.homeTeamId ?? "").trim();
  const defaultAway = String(opts?.awayTeamId ?? "").trim();
  const homeTeam = String(opts?.homeTeam ?? "").trim();
  const awayTeam = String(opts?.awayTeam ?? "").trim();

  // Request-local roster map shared across concurrent workers (coalesced fetch).
  const rosterByGame = new Map<string, Map<string, { athleteId: string; teamId: string }>>();

  async function loadRosterMap(homeTeamId: string, awayTeamId: string) {
    const gameKey = `${sport}:${homeTeamId}:${awayTeamId}`;
    const existing = rosterByGame.get(gameKey);
    if (existing) return existing;

    const { value, coalesced } = await withInflightCoalesce(`roster-game:${gameKey}`, async () => {
      stats.rosterCalls += 1;
      stats.providerCalls += 1;
      const roster = await fetchGameRoster(sport, homeTeamId, awayTeamId);
      const byName = new Map<string, { athleteId: string; teamId: string }>();
      for (const r of roster) {
        if (!r.athleteId) continue;
        byName.set(normalizePlayerName(r.name), { athleteId: r.athleteId, teamId: r.teamId });
      }
      return byName;
    });
    if (coalesced) stats.coalesced += 1;
    rosterByGame.set(gameKey, value);
    return value;
  }

  async function resolveMiss(miss: UniqueMiss): Promise<string | null> {
    const { value, coalesced } = await withInflightCoalesce(`athlete:${miss.coalesceKey}`, async () => {
      // Dedicated identity cache (positive ids only).
      for (const key of miss.identityKeysToProbe) {
        const hit = await getAthleteIdentity(key);
        if (hit) {
          stats.cacheHits += 1;
          return hit;
        }
      }
      stats.cacheMisses += 1;

      // Roster first when ESPN team ids are present.
      if (miss.homeTeamId && miss.awayTeamId) {
        const byName = await loadRosterMap(miss.homeTeamId, miss.awayTeamId);
        const fromRoster = byName.get(normalizePlayerName(miss.player));
        if (fromRoster?.athleteId) {
          const storeKey = athleteIdentityKey(miss.sport, miss.player, fromRoster.teamId);
          await setAthleteIdentity(storeKey, fromRoster.athleteId, ATHLETE_IDENTITY_TTL_MS);
          if (miss.preferredTeamId && miss.preferredTeamId !== fromRoster.teamId) {
            await setAthleteIdentity(
              athleteIdentityKey(miss.sport, miss.player, miss.preferredTeamId),
              fromRoster.athleteId,
              ATHLETE_IDENTITY_TTL_MS,
            );
          }
          return fromRoster.athleteId;
        }
      }

      // Search fallback only when necessary.
      stats.searchCalls += 1;
      stats.providerCalls += 1;
      const tokens = teamTokens(miss.homeTeam, miss.awayTeam);
      const fromSearch = await searchAthleteId(miss.sport, miss.player, tokens);
      if (fromSearch) {
        const storeTeamId = miss.preferredTeamId || miss.homeTeamId || miss.awayTeamId || "";
        await setAthleteIdentity(
          athleteIdentityKey(miss.sport, miss.player, storeTeamId),
          fromSearch,
          ATHLETE_IDENTITY_TTL_MS,
        );
        return fromSearch;
      }
      // Unresolved — do not cache null (no poison).
      return null;
    });
    if (coalesced) stats.coalesced += 1;
    return value;
  }

  // Partition: stamped fast path vs misses needing resolution.
  type Slot =
    | { kind: "stamped"; prop: SimPropRequest }
    | { kind: "miss"; prop: SimPropRequest; miss: UniqueMiss; index: number };

  const slots: Slot[] = props.map((p, index) => {
    const homeTeamId = String(p.homeTeamId ?? defaultHome).trim();
    const awayTeamId = String(p.awayTeamId ?? defaultAway).trim();
    const stamped = String(p.athleteId ?? "").trim();
    if (stamped) {
      stats.stampedFastPath += 1;
      // Warm dedicated identity cache from authoritative stamped id (no fabricate).
      const teamId = derivePlayerTeamId(p, homeTeamId, awayTeamId);
      if (teamId) {
        void setAthleteIdentity(athleteIdentityKey(sport, p.player, teamId), stamped);
      }
      return {
        kind: "stamped" as const,
        prop: { ...p, athleteId: stamped, sport: String(p.sport ?? sport).toLowerCase() },
      };
    }
    return {
      kind: "miss" as const,
      prop: p,
      miss: buildUniqueMiss(sport, p, homeTeamId, awayTeamId, homeTeam, awayTeam),
      index,
    };
  });

  // Deduplicate miss work by coalesce key, resolve with concurrency 4.
  const uniqueMisses = new Map<string, UniqueMiss>();
  for (const slot of slots) {
    if (slot.kind === "miss") uniqueMisses.set(slot.miss.coalesceKey, slot.miss);
  }
  const uniqueList = [...uniqueMisses.values()];
  const resolvedByCoalesce = new Map<string, string | null>();

  if (uniqueList.length) {
    const results = await mapWithConcurrency(
      uniqueList,
      ATHLETE_IDENTITY_CONCURRENCY,
      async (miss) => {
        const id = await resolveMiss(miss);
        return { key: miss.coalesceKey, id };
      },
    );
    for (const r of results) resolvedByCoalesce.set(r.key, r.id);
  }

  const out: SimPropRequest[] = slots.map((slot) => {
    if (slot.kind === "stamped") return slot.prop;
    const id = resolvedByCoalesce.get(slot.miss.coalesceKey) ?? null;
    return {
      ...slot.prop,
      sport: String(slot.prop.sport ?? sport).toLowerCase(),
      ...(id ? { athleteId: id } : {}),
    };
  });

  // Stamp isHome + opponentTeamId from roster team ids (never from player names).
  const stamped = await stampSideContextFromRoster(
    sport,
    out,
    defaultHome,
    defaultAway,
    loadRosterMap,
  );

  return { props: stamped, stats };
}

async function stampSideContextFromRoster(
  sport: string,
  props: SimPropRequest[],
  defaultHome: string,
  defaultAway: string,
  loadRosterMap: (
    homeTeamId: string,
    awayTeamId: string,
  ) => Promise<Map<string, { athleteId: string; teamId: string }>>,
): Promise<SimPropRequest[]> {
  // Group by game team-id pair so we load each roster at most once.
  const byGame = new Map<string, SimPropRequest[]>();
  for (const p of props) {
    const home = String(p.homeTeamId ?? defaultHome).trim();
    const away = String(p.awayTeamId ?? defaultAway).trim();
    const key = `${home}|${away}`;
    const arr = byGame.get(key) ?? [];
    arr.push(p);
    byGame.set(key, arr);
  }

  const out: SimPropRequest[] = [];
  for (const [key, group] of byGame) {
    const [home, away] = key.split("|");
    if (!home || !away) {
      out.push(...group.map((p) => stampPropSideContext(p, home || null, away || null)));
      continue;
    }
    let byAthlete = new Map<string, string>();
    try {
      const byName = await loadRosterMap(home, away);
      for (const v of byName.values()) {
        if (v.athleteId) byAthlete.set(v.athleteId, v.teamId);
      }
    } catch {
      byAthlete = new Map();
    }
    for (const p of group) {
      const athleteId = String(p.athleteId ?? "").trim();
      const fromRoster = athleteId ? byAthlete.get(athleteId) ?? null : null;
      const playerTeamId = p.playerTeamId ?? fromRoster;
      out.push(stampPropSideContext(p, home, away, playerTeamId));
    }
  }
  return out;
}
