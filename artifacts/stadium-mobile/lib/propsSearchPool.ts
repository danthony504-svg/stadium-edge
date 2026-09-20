import { getGames, getOdds, getProps, type EspnGame, type PlayerProp } from "./api.ts";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

export type TeamInfo = {
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeAbbr: string | null;
  awayAbbr: string | null;
};

export type GameProps = {
  eventId: string;
  gameLabel: string;
  startsAt: string;
  sport: string;
  props: PlayerProp[];
  allProps: PlayerProp[];
  teams: TeamInfo | null;
};

export type GamePropsPage = { games: GameProps[]; total: number };

export function buildIdMap(games: EspnGame[]): Map<string, TeamInfo> {
  const map = new Map<string, TeamInfo>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    map.set(`${nickname(away)}|${nickname(home)}`.toLowerCase(), {
      homeTeamId: g.homeTeamId ?? null,
      awayTeamId: g.awayTeamId ?? null,
      homeAbbr: g.homeAbbr ?? null,
      awayAbbr: g.awayAbbr ?? null,
    });
  }
  return map;
}

export function teamAbbrFor(prop: PlayerProp, teams: TeamInfo | null): string | null {
  if (!teams || !prop.playerTeamId) return null;
  if (prop.playerTeamId === teams.homeTeamId) return teams.homeAbbr;
  if (prop.playerTeamId === teams.awayTeamId) return teams.awayAbbr;
  return null;
}

// Fetch odds (for event ids) and ESPN games (for team ids), then pull player
// props for the soonest `limit` games in the betting window.
export async function fetchAllProps(
  sport: string,
  limit: number,
  signal?: AbortSignal,
): Promise<GamePropsPage> {
  const [odds, games] = await Promise.all([
    getOdds(sport, signal),
    getGames(sport, signal).catch(() => [] as EspnGame[]),
  ]);
  const idMap = buildIdMap(games);
  const HORIZON_H = sport === "soccer" ? 14 * 24 : 48;
  const now = Date.now();
  const inWindow = (iso?: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return t > now - 4 * 3600_000 && t < now + HORIZON_H * 3600_000;
  };
  const windowed = odds
    .filter((g) => inWindow(g.commenceTime))
    .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  const pickable = windowed.slice(0, Math.max(1, limit));

  let failures = 0;
  const results = await Promise.all(
    pickable.map(async (g): Promise<GameProps> => {
      const ids = idMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()) ?? null;
      try {
        const r = await getProps(
          {
            sport,
            eventId: g.id,
            home: g.homeTeam,
            away: g.awayTeam,
            homeTeamId: ids?.homeTeamId,
            awayTeamId: ids?.awayTeamId,
          },
          signal,
        );
        const all = (r.props ?? []).filter((p) => p.overPrice != null || p.underPrice != null);
        const mains = all.filter((p) => !p.alt);
        return {
          eventId: g.id,
          gameLabel: `${g.awayTeam} @ ${g.homeTeam}`,
          startsAt: g.commenceTime,
          sport,
          props: mains,
          allProps: all,
          teams: ids,
        };
      } catch {
        failures += 1;
        return {
          eventId: g.id,
          gameLabel: `${g.awayTeam} @ ${g.homeTeam}`,
          startsAt: g.commenceTime,
          sport,
          props: [],
          allProps: [],
          teams: ids,
        };
      }
    }),
  );
  if (pickable.length > 0 && failures === pickable.length) {
    throw new Error("All player-prop requests failed");
  }
  return { games: results.filter((r) => r.props.length > 0), total: windowed.length };
}
