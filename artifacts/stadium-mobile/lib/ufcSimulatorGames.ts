// UFC Game Simulator slate — ESPN scoreboard + odds API fallbacks when the games
// route returns event-level cards without fighter names (stale API deploy).

import type { EspnGame, OddsGame } from "./api";

function isPregameFight(game: {
  startsAt?: string | null;
  state?: string | null;
  status?: string | null;
}): boolean {
  if (game.state === "post" || game.state === "in") return false;
  const status = String(game.status ?? "").toLowerCase();
  if (
    status.includes("final") ||
    status.includes("in progress") ||
    status.includes("halftime") ||
    status.includes("end of")
  ) {
    return false;
  }
  const t = Date.parse(game.startsAt ?? "");
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t < now + 48 * 3600_000;
}

export function isUfcFightRow(game: EspnGame | null | undefined): boolean {
  return !!game?.homeTeam?.trim() && !!game?.awayTeam?.trim();
}

type EspnCompetitor = {
  homeAway?: "home" | "away";
  order?: number;
  score?: string;
  id?: string;
  athlete?: { id?: string; displayName?: string; shortName?: string };
  team?: { id?: string; displayName?: string; abbreviation?: string; logo?: string };
};

type EspnCompetition = {
  id?: string;
  date?: string;
  venue?: { fullName?: string };
  status?: {
    displayClock?: string;
    period?: number;
    type?: { description?: string; state?: string; shortDetail?: string };
  };
  competitors?: EspnCompetitor[];
};

type EspnEvent = {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status?: {
    displayClock?: string;
    period?: number;
    type?: { description?: string; state?: string; shortDetail?: string };
  };
  competitions?: EspnCompetition[];
};

function resolveMmaSides(competitors: EspnCompetitor[] | undefined) {
  if (!competitors?.length) return { home: undefined, away: undefined };
  const sorted = [...competitors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { home: sorted[0], away: sorted[1] };
}

function competitorName(c: EspnCompetitor | undefined): string | null {
  if (!c) return null;
  return c.team?.displayName ?? c.athlete?.displayName ?? null;
}

function competitorId(c: EspnCompetitor | undefined): string | null {
  if (!c) return null;
  const id = c.team?.id ?? c.athlete?.id ?? c.id;
  return id != null ? String(id) : null;
}

function competitorAbbr(c: EspnCompetitor | undefined): string | null {
  if (!c) return null;
  return c.team?.abbreviation ?? c.athlete?.shortName ?? null;
}

function competitorLogo(c: EspnCompetitor | undefined): string | null {
  if (!c) return null;
  return c.team?.logo ?? null;
}

export function mapEspnMmaScoreboardEvents(events: EspnEvent[]): EspnGame[] {
  const out: EspnGame[] = [];
  for (const e of events) {
    for (const comp of e.competitions ?? []) {
      const { home, away } = resolveMmaSides(comp.competitors);
      const awayName = competitorName(away);
      const homeName = competitorName(home);
      if (!awayName || !homeName) continue;

      const statusObj = comp.status ?? e.status;
      const awayScore = away?.score != null ? parseInt(away.score, 10) : null;
      const homeScore = home?.score != null ? parseInt(home.score, 10) : null;
      const fightLabel = `${awayName} vs. ${homeName}`;

      out.push({
        id: String(comp.id ?? e.id),
        sport: "ufc",
        name: fightLabel,
        shortName: fightLabel,
        status:
          e.status?.type?.description ??
          (statusObj?.type?.state === "in"
            ? "In Progress"
            : statusObj?.type?.state === "post"
              ? "Final"
              : statusObj?.type?.state === "pre"
                ? "Scheduled"
                : "Unknown"),
        startsAt: comp.date ?? e.date,
        homeTeam: homeName,
        awayTeam: awayName,
        homeScore: Number.isFinite(homeScore) ? homeScore : null,
        awayScore: Number.isFinite(awayScore) ? awayScore : null,
        homeTeamId: competitorId(home),
        awayTeamId: competitorId(away),
        homeLogo: competitorLogo(home),
        awayLogo: competitorLogo(away),
        homeAbbr: competitorAbbr(home),
        awayAbbr: competitorAbbr(away),
        venue: comp.venue?.fullName ?? null,
        clock: statusObj?.displayClock ?? null,
        period: statusObj?.period ?? null,
        periodLabel: statusObj?.type?.shortDetail ?? statusObj?.type?.description ?? null,
        state: statusObj?.type?.state ?? e.status?.type?.state ?? null,
      });
    }
  }
  return out;
}

export function hasUfcFightLabels(games: EspnGame[]): boolean {
  return games.some(isUfcFightRow);
}

function normFightKey(away: string, home: string): string {
  return `${away.toLowerCase().trim()}|${home.toLowerCase().trim()}`;
}

export function mapOddsRowsToUfcSimulatorGames(odds: OddsGame[]): EspnGame[] {
  const seen = new Set<string>();
  const out: EspnGame[] = [];
  for (const row of odds) {
    const away = row.awayTeam?.trim();
    const home = row.homeTeam?.trim();
    if (!away || !home) continue;
    const key = normFightKey(away, home);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = `${away} vs. ${home}`;
    const game: EspnGame = {
      id: row.id || `ufc-odds-${key.replace(/\|/g, "-")}`,
      sport: "ufc",
      name: label,
      shortName: label,
      status: "Scheduled",
      startsAt: row.commenceTime,
      homeTeam: home,
      awayTeam: away,
      homeScore: null,
      awayScore: null,
      homeTeamId: null,
      awayTeamId: null,
      homeLogo: null,
      awayLogo: null,
      homeAbbr: null,
      awayAbbr: null,
      venue: null,
      clock: null,
      period: null,
      periodLabel: null,
      state: "pre",
    };
    if (isPregameFight(game)) out.push(game);
  }
  return out;
}

async function httpGet(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    const { fetch: expoFetch } = await import("expo/fetch");
    return expoFetch(url, {
      headers: { Accept: "application/json", "User-Agent": "StadiumEdge/1.0" },
      signal,
    });
  } catch {
    return fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "StadiumEdge/1.0" },
      signal,
    });
  }
}

export async function fetchUfcSimulatorGamesFromEspn(signal?: AbortSignal): Promise<EspnGame[]> {
  try {
    const res = await httpGet("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard", signal);
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: EspnEvent[] };
    return mapEspnMmaScoreboardEvents(data.events ?? []).filter((g) => isPregameFight(g));
  } catch {
    return [];
  }
}

/** Prefer API fights with names, then ESPN card, then odds-feed matchups. */
export async function resolveUfcSimulatorGames(
  apiRows: EspnGame[],
  fetchOdds: (signal?: AbortSignal) => Promise<OddsGame[]>,
  signal?: AbortSignal,
): Promise<EspnGame[]> {
  const labeled = apiRows.filter(isUfcFightRow);
  if (labeled.length) return labeled;

  const [espn, odds] = await Promise.all([
    fetchUfcSimulatorGamesFromEspn(signal),
    fetchOdds(signal).catch(() => [] as OddsGame[]),
  ]);
  if (espn.length) return espn;

  const fromOdds = mapOddsRowsToUfcSimulatorGames(odds);
  if (fromOdds.length) return fromOdds;

  return [];
}
