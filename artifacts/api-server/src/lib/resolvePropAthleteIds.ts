import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";
import { fetchGameRoster, normalizePlayerName } from "./espnRoster.js";
import type { SimPropRequest } from "./monteCarloBuild.js";

const LEAGUE_TO_SPORT: Record<string, string> = {
  nba: "nba",
  wnba: "wnba",
  mlb: "mlb",
  nfl: "nfl",
  nhl: "nhl",
};

type SearchItem = {
  id?: string;
  displayName?: string;
  league?: string;
  defaultLeagueSlug?: string;
  teamRelationships?: Array<{ displayName?: string }>;
};

async function searchAthleteId(
  sport: string,
  player: string,
  teamTokens: string[],
): Promise<string | null> {
  const query = player.trim();
  if (query.length < 2) return null;
  try {
    const key = `player-search:${query.toLowerCase()}`;
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
    /* best-effort */
  }
  return null;
}

function teamTokens(...names: Array<string | null | undefined>): string[] {
  return names
    .filter(Boolean)
    .map((t) => String(t).trim().split(/\s+/).pop()!.toLowerCase())
    .filter(Boolean);
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
  },
): Promise<SimPropRequest[]> {
  if (!ESPN_SPORT_PATHS[sport]) return props;

  const rosterCache = new Map<string, Map<string, string>>();
  const searchCache = new Map<string, string | null>();

  async function rosterByTeamIds(homeTeamId: string, awayTeamId: string): Promise<Map<string, string>> {
    const cacheKey = `${homeTeamId}:${awayTeamId}`;
    const hit = rosterCache.get(cacheKey);
    if (hit) return hit;
    const roster = await fetchGameRoster(sport, homeTeamId, awayTeamId);
    const byName = new Map(
      roster
        .filter((r) => r.athleteId)
        .map((r) => [normalizePlayerName(r.name), r.athleteId!] as const),
    );
    rosterCache.set(cacheKey, byName);
    return byName;
  }

  async function resolveOne(
    p: SimPropRequest,
    homeTeamId: string,
    awayTeamId: string,
    homeTeam: string,
    awayTeam: string,
  ): Promise<SimPropRequest> {
    if (p.athleteId) return p;

    if (homeTeamId && awayTeamId) {
      const byName = await rosterByTeamIds(homeTeamId, awayTeamId);
      const fromRoster = byName.get(normalizePlayerName(p.player));
      if (fromRoster) return { ...p, athleteId: fromRoster };
    }

    const searchKey = `${sport}:${p.player}:${homeTeamId}:${awayTeamId}`;
    if (searchCache.has(searchKey)) {
      const cached = searchCache.get(searchKey);
      return cached ? { ...p, athleteId: cached } : p;
    }

    const tokens = teamTokens(homeTeam, awayTeam);
    const fromSearch = await searchAthleteId(sport, p.player, tokens);
    searchCache.set(searchKey, fromSearch);
    return fromSearch ? { ...p, athleteId: fromSearch } : p;
  }

  const out: SimPropRequest[] = [];
  for (const p of props) {
    const homeTeamId = String(p.homeTeamId ?? opts?.homeTeamId ?? "").trim();
    const awayTeamId = String(p.awayTeamId ?? opts?.awayTeamId ?? "").trim();
    const homeTeam = String(opts?.homeTeam ?? "").trim();
    const awayTeam = String(opts?.awayTeam ?? "").trim();
    out.push(await resolveOne(p, homeTeamId, awayTeamId, homeTeam, awayTeam));
  }
  return out;
}
