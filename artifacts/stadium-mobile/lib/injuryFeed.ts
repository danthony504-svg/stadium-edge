import type { InjuryTeam } from "./api.ts";
import {
  buildGameInjuryReport,
  isMatchupInjuryConfirmedClear,
  type GameInjuryReport,
} from "./injuries.ts";

/** Coach must use this verbatim when the ESPN injury feed is unreachable. */
export const COACH_INJURY_FEED_UNAVAILABLE_MESSAGE =
  "My injury data feed is currently unavailable, so I can't verify today's injuries. I won't guess or invent player statuses.";

export type InjuryFeedMeta = {
  /** True when every checked sport returned a live feed response. */
  connected: boolean;
  sportsChecked: string[];
  sportsUnavailable: string[];
};

export type InjuryContextPack = {
  matchupInjuries: Record<string, GameInjuryReport>;
  /** Games where both teams resolved and ESPN confirmed zero injury entries. */
  injuryClearedGames: string[];
  injuryFeed: InjuryFeedMeta;
};

export type InjuryGameRef = {
  sport: string;
  game: string;
  away: string;
  home: string;
};

export async function fetchInjuriesBySport(
  sports: string[],
  getInjuries: (sport: string, signal?: AbortSignal) => Promise<InjuryTeam[]>,
  signal?: AbortSignal,
): Promise<Map<string, InjuryTeam[] | null>> {
  const rows = await Promise.all(
    sports.map(async (sport) => {
      try {
        const teams = await getInjuries(sport, signal);
        return { sport, teams, ok: true as const };
      } catch {
        return { sport, teams: null, ok: false as const };
      }
    }),
  );
  const map = new Map<string, InjuryTeam[] | null>();
  for (const row of rows) {
    map.set(row.sport, row.ok ? row.teams : null);
  }
  return map;
}

export function buildInjuryContextPack(
  sports: string[],
  injuriesBySport: Map<string, InjuryTeam[] | null>,
  games: InjuryGameRef[],
): InjuryContextPack {
  const sportsUnavailable = sports.filter((s) => injuriesBySport.get(s) === null);
  const injuryFeed: InjuryFeedMeta = {
    connected: sports.length > 0 && sportsUnavailable.length === 0,
    sportsChecked: [...sports],
    sportsUnavailable,
  };
  const matchupInjuries: Record<string, GameInjuryReport> = {};
  const injuryClearedGames: string[] = [];
  for (const g of games) {
    const teams = injuriesBySport.get(g.sport);
    if (teams === null) continue;
    const report = buildGameInjuryReport(g.sport, teams, g.away, g.home);
    if (report) {
      matchupInjuries[g.game] = report;
      continue;
    }
    if (isMatchupInjuryConfirmedClear(g.sport, teams, g.away, g.home)) {
      injuryClearedGames.push(g.game);
    }
  }
  return { matchupInjuries, injuryClearedGames, injuryFeed };
}

/** Injury reports, lineups, questionable/out players, minutes restrictions, injury impact. */
export function isInjuryIntelAsk(text: string): boolean {
  return /\b(?:injur(?:y|ies)|injury report|questionable|doubtful|probable|out\b|gtd|game[- ]?time decision|minutes restriction|minutes limit|starting lineup|starters?|who(?:'s| is) (?:out|playing|starting|sitting)|lineup|injured|injury impact|value.*injur|injur.*prop)\b/i.test(
    text,
  );
}
