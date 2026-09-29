/**
 * Real NFL/NCAAF yards allowed — computed from recent completed box scores
 * (opponent team rushingYards + netPassingYards), never invented.
 * One box-score fetch yields both rush + pass packs so Coach stays fast.
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
  stuffs: number | null;
};

export type PassDefenseAllowed = {
  passingYardsAllowedPerGame: number | null;
  yardsPerPassAllowed: number | null;
  sampleSize: number;
};

export type FootballDefenseAllowed = {
  rush: RushDefenseAllowed;
  pass: PassDefenseAllowed;
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

type BoxOffenseRow = {
  teamId: string;
  rushingYards: number;
  rushAttempts: number;
  passingYards: number | null;
  passAttempts: number;
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

async function fetchBoxOffense(
  sport: string,
  eventId: string,
): Promise<BoxOffenseRow[]> {
  const cdn = BOX_CDN[sport];
  if (!cdn) return [];
  // Bump cache key — same CDN payload now carries pass yards too.
  return cachedJson(`box-off:${sport}:${eventId}:v2`, 6 * 60 * 60 * 1000, async () => {
    const r = await fetch(`${cdn}?xhr=1&gameId=${encodeURIComponent(eventId)}`);
    if (!r.ok) throw new Error(`boxscore ${r.status}`);
    const data = (await r.json()) as {
      gamepackageJSON?: { boxscore?: { teams?: BoxTeam[] } };
    };
    const teams = data.gamepackageJSON?.boxscore?.teams ?? [];
    const out: BoxOffenseRow[] = [];
    for (const t of teams) {
      const teamId = t.team?.id != null ? String(t.team.id) : "";
      if (!teamId) continue;
      const rushYds = numStat(t.statistics, "rushingYards");
      const rushAtt = numStat(t.statistics, "rushingAttempts");
      // ESPN boxscore uses netPassingYards on team stats; fall back to passingYards.
      const passYds =
        numStat(t.statistics, "netPassingYards") ??
        numStat(t.statistics, "passingYards");
      const passAtt =
        numStat(t.statistics, "passingAttempts") ??
        numStat(t.statistics, "completions") ??
        0;
      if (rushYds == null && passYds == null) continue;
      out.push({
        teamId,
        rushingYards: rushYds ?? 0,
        rushAttempts: rushAtt ?? 0,
        passingYards: passYds,
        passAttempts: passAtt ?? 0,
      });
    }
    return out;
  });
}

const emptyRush = (): RushDefenseAllowed => ({
  rushingYardsAllowedPerGame: null,
  yardsPerRushAllowed: null,
  sampleSize: 0,
  stuffs: null,
});

const emptyPass = (): PassDefenseAllowed => ({
  passingYardsAllowedPerGame: null,
  yardsPerPassAllowed: null,
  sampleSize: 0,
});

/**
 * Average rush + pass yards the OPPONENT put up against this team
 * over the last `maxGames` completed contests. Shared schedule + box fetches.
 */
export async function computeFootballDefenseAllowed(
  sport: string,
  teamId: string,
  opts?: { maxGames?: number },
): Promise<FootballDefenseAllowed> {
  const path = ESPN_PATH[sport];
  const empty: FootballDefenseAllowed = { rush: emptyRush(), pass: emptyPass() };
  if (!path || !teamId) return empty;

  const maxGames = Math.max(1, Math.min(opts?.maxGames ?? 5, 8));

  try {
    const schedule = await cachedJson<ScheduleEvent[]>(
      `fb-def-sched:${sport}:${teamId}:v1`,
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
    const recent = completed.slice().reverse().slice(0, maxGames);

    let rushYards = 0;
    let rushAtt = 0;
    let rushN = 0;
    let passYards = 0;
    let passAtt = 0;
    let passN = 0;

    for (const ev of recent) {
      const eventId = String(ev.id);
      const rows = await fetchBoxOffense(sport, eventId).catch(() => []);
      if (rows.length < 2) continue;
      const opp = rows.find((r) => r.teamId !== String(teamId));
      if (!opp) continue;
      rushYards += opp.rushingYards;
      rushAtt += opp.rushAttempts;
      rushN += 1;
      if (opp.passingYards != null) {
        passYards += opp.passingYards;
        passAtt += opp.passAttempts;
        passN += 1;
      }
    }

    return {
      rush:
        rushN === 0
          ? emptyRush()
          : {
              rushingYardsAllowedPerGame: Math.round((rushYards / rushN) * 10) / 10,
              yardsPerRushAllowed:
                rushAtt > 0 ? Math.round((rushYards / rushAtt) * 100) / 100 : null,
              sampleSize: rushN,
              stuffs: null,
            },
      pass:
        passN === 0
          ? emptyPass()
          : {
              passingYardsAllowedPerGame: Math.round((passYards / passN) * 10) / 10,
              yardsPerPassAllowed:
                passAtt > 0 ? Math.round((passYards / passAtt) * 100) / 100 : null,
              sampleSize: passN,
            },
    };
  } catch {
    return empty;
  }
}

/** @deprecated Prefer computeFootballDefenseAllowed — kept for callers that only need rush. */
export async function computeRushDefenseAllowed(
  sport: string,
  teamId: string,
  opts?: { maxGames?: number },
): Promise<RushDefenseAllowed> {
  const pack = await computeFootballDefenseAllowed(sport, teamId, opts);
  return pack.rush;
}
