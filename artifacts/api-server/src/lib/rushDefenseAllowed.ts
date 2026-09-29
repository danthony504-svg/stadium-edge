/**
 * Real NFL/NCAAF rushing yards allowed — computed from recent completed
 * box scores (opponent team rushingYards), never invented.
 */

import { cachedJson } from "./sports.js";

const ESPN_PATH: Record<string, string> = {
  nfl: "football/nfl",
  ncaaf: "football/college-football",
};

const BOX_CDN: Record<string, string> = {
  nfl: "https://cdn.espn.com/core/nfl/boxscore",
  ncaaf: "https://cdn.espn.com/core/college-football/boxscore",
};

export type RushDefenseAllowed = {
  rushingYardsAllowedPerGame: number | null;
  yardsPerRushAllowed: number | null;
  sampleSize: number;
  /** Season stuffs from team stats when available (descriptive). */
  stuffs: number | null;
};

type ScheduleEvent = {
  id?: string;
  competitions?: Array<{
    status?: { type?: { completed?: boolean } };
    competitors?: Array<{
      id?: string;
      homeAway?: string;
      team?: { id?: string; abbreviation?: string };
    }>;
  }>;
};

type BoxTeam = {
  team?: { id?: string; abbreviation?: string };
  statistics?: Array<{
    name?: string;
    value?: number | string | null;
    displayValue?: string | null;
  }>;
};

function numStat(
  stats: BoxTeam["statistics"],
  name: string,
): number | null {
  const s = (stats ?? []).find((x) => x.name === name);
  if (!s) return null;
  if (typeof s.value === "number" && Number.isFinite(s.value)) return s.value;
  const n = Number(s.displayValue);
  return Number.isFinite(n) ? n : null;
}

async function fetchBoxRushing(
  sport: string,
  eventId: string,
): Promise<Array<{ teamId: string; rushingYards: number; rushAttempts: number }>> {
  const cdn = BOX_CDN[sport];
  if (!cdn) return [];
  return cachedJson(`box-rush:${sport}:${eventId}:v1`, 6 * 60 * 60 * 1000, async () => {
    const r = await fetch(`${cdn}?xhr=1&gameId=${encodeURIComponent(eventId)}`);
    if (!r.ok) throw new Error(`boxscore ${r.status}`);
    const data = (await r.json()) as {
      gamepackageJSON?: { boxscore?: { teams?: BoxTeam[] } };
    };
    const teams = data.gamepackageJSON?.boxscore?.teams ?? [];
    const out: Array<{ teamId: string; rushingYards: number; rushAttempts: number }> = [];
    for (const t of teams) {
      const teamId = t.team?.id != null ? String(t.team.id) : "";
      if (!teamId) continue;
      const yds = numStat(t.statistics, "rushingYards");
      const att = numStat(t.statistics, "rushingAttempts");
      if (yds == null) continue;
      out.push({
        teamId,
        rushingYards: yds,
        rushAttempts: att ?? 0,
      });
    }
    return out;
  });
}

/**
 * Average rushing yards / YPC the OPPONENT put up against this team
 * over the last `maxGames` completed contests.
 */
export async function computeRushDefenseAllowed(
  sport: string,
  teamId: string,
  opts?: { maxGames?: number },
): Promise<RushDefenseAllowed> {
  const path = ESPN_PATH[sport];
  const empty: RushDefenseAllowed = {
    rushingYardsAllowedPerGame: null,
    yardsPerRushAllowed: null,
    sampleSize: 0,
    stuffs: null,
  };
  if (!path || !teamId) return empty;

  const maxGames = Math.max(1, Math.min(opts?.maxGames ?? 5, 8));

  try {
    const schedule = await cachedJson<ScheduleEvent[]>(
      `rush-def-sched:${sport}:${teamId}:v1`,
      60 * 60 * 1000,
      async () => {
        const r = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/schedule`,
        );
        if (!r.ok) throw new Error(`schedule ${r.status}`);
        const data = (await r.json()) as { events?: ScheduleEvent[] };
        return data.events ?? [];
      },
    );

    const completed = schedule.filter((e) => {
      const st = e.competitions?.[0]?.status?.type?.completed;
      return !!st && !!e.id;
    });
    // Most recent first.
    const recent = completed.slice().reverse().slice(0, maxGames);

    let yards = 0;
    let attempts = 0;
    let n = 0;
    for (const ev of recent) {
      const eventId = String(ev.id);
      const rows = await fetchBoxRushing(sport, eventId).catch(() => []);
      if (rows.length < 2) continue;
      const opp = rows.find((r) => r.teamId !== String(teamId));
      if (!opp) continue;
      yards += opp.rushingYards;
      attempts += opp.rushAttempts;
      n += 1;
    }

    if (n === 0) return empty;
    return {
      rushingYardsAllowedPerGame: Math.round((yards / n) * 10) / 10,
      yardsPerRushAllowed:
        attempts > 0 ? Math.round((yards / attempts) * 100) / 100 : null,
      sampleSize: n,
      stuffs: null,
    };
  } catch {
    return empty;
  }
}
