import { ESPN_SPORT_PATHS, cachedJson } from "./sports.js";

export type InjuryTeam = {
  team?: string;
  entries?: Array<{
    player?: string;
    status?: string;
    position?: string | null;
    athleteId?: string | null;
  }>;
};

type RawInjuries = {
  injuries?: Array<{
    displayName?: string;
    injuries?: Array<{
      athlete?: {
        id?: string | number;
        displayName?: string;
        position?: { abbreviation?: string };
      };
      status?: string;
    }>;
  }>;
};

/**
 * ESPN injuries for prop-sim / Opportunity Shift.
 * Must include position (+ athleteId when present) so vacancy roles resolve;
 * without position the Opportunity Shift engine creates zero vacancies.
 */
export async function fetchEspnInjuries(sport: string): Promise<InjuryTeam[]> {
  const path = ESPN_SPORT_PATHS[sport];
  if (!path) return [];
  try {
    const data = await cachedJson<RawInjuries>(`injuries:${path}`, 10 * 60 * 1000, async () => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/injuries`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ESPN injuries ${r.status}`);
      return (await r.json()) as RawInjuries;
    });
    return (data.injuries ?? []).map((team) => ({
      team: team.displayName ?? "Unknown",
      entries: (team.injuries ?? []).map((inj) => ({
        player: inj.athlete?.displayName ?? "Unknown",
        status: inj.status ?? "Unknown",
        position: inj.athlete?.position?.abbreviation ?? null,
        athleteId:
          inj.athlete?.id != null && String(inj.athlete.id).trim()
            ? String(inj.athlete.id)
            : null,
      })),
    }));
  } catch {
    return [];
  }
}
