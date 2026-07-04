import type { EspnGame, OddsGame, PlayerProp } from "./api";

/** One featured prop row cached for the Discover hero / rails. */
export type CachedPropEntry = {
  prop: PlayerProp;
  gameLabel: string;
  startsAt: string;
  teamAbbr: string | null;
  teamLogo: string | null;
};

const heroBySport = new Map<string, CachedPropEntry[]>();
const liveBySport = new Map<string, EspnGame[]>();
const upcomingBySport = new Map<string, OddsGame[]>();

export function cachedHeroLegs(sport: string): CachedPropEntry[] {
  return heroBySport.get(sport) ?? [];
}

export function rememberHeroLegs(sport: string, legs: CachedPropEntry[]): void {
  if (legs.length >= 2) heroBySport.set(sport, legs);
}

export function cachedLiveGames(sport: string): EspnGame[] {
  return liveBySport.get(sport) ?? [];
}

export function rememberLiveGames(sport: string, games: EspnGame[]): void {
  if (games.length > 0) liveBySport.set(sport, games);
}

export function cachedUpcomingGames(sport: string): OddsGame[] {
  return upcomingBySport.get(sport) ?? [];
}

export function rememberUpcomingGames(sport: string, games: OddsGame[]): void {
  if (games.length > 0) upcomingBySport.set(sport, games);
}
