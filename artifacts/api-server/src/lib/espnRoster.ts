import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";

export const normalizePlayerName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

type RosterAthlete = {
  id?: string | number;
  fullName?: string;
  displayName?: string;
  headshot?: { href?: string } | string;
};
type EspnRoster = {
  athletes?: Array<RosterAthlete | { items?: RosterAthlete[]; position?: string }>;
};

export type RosterEntry = {
  headshot: string | null;
  athleteId: string | null;
  teamId: string;
  name: string;
};

export async function fetchGameRoster(
  sport: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<RosterEntry[]> {
  const espnPath = ESPN_SPORT_PATHS[sport];
  if (!espnPath) return [];

  const entries: RosterEntry[] = [];
  for (const teamId of [homeTeamId, awayTeamId].filter(Boolean)) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${teamId}/roster`;
    const data = await cachedJson<EspnRoster>(`roster:${espnPath}:${teamId}`, 6 * 60 * 60 * 1000, async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN roster ${r.status}`);
      return (await r.json()) as EspnRoster;
    }).catch(() => null);
    if (!data) continue;

    const flat: RosterAthlete[] = [];
    for (const entry of data.athletes ?? []) {
      if (entry && typeof entry === "object" && "items" in entry && Array.isArray(entry.items)) {
        flat.push(...entry.items);
      } else {
        flat.push(entry as RosterAthlete);
      }
    }
    for (const a of flat) {
      const name = a.fullName ?? a.displayName;
      if (!name) continue;
      const href = typeof a.headshot === "string" ? a.headshot : a.headshot?.href;
      entries.push({
        name,
        headshot: href ?? null,
        athleteId: a.id != null ? String(a.id) : null,
        teamId,
      });
    }
  }
  return entries;
}
