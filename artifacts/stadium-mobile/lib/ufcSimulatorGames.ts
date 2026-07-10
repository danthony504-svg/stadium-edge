// Client-side ESPN MMA scoreboard for UFC Game Simulator when the API server
// returns event-level cards without per-bout competitors (stale deploy).

import type { EspnGame } from "./api";

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
  return games.some((g) => !!g.homeTeam && !!g.awayTeam);
}

export async function fetchUfcSimulatorGamesFromEspn(signal?: AbortSignal): Promise<EspnGame[]> {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard", {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: EspnEvent[] };
    return mapEspnMmaScoreboardEvents(data.events ?? []).filter((g) => isPregameFight(g));
  } catch {
    return [];
  }
}
