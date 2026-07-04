import type { EspnGame, PlayerProp } from "./api";

const gamesBySport = new Map<string, EspnGame[]>();
const propsByGame = new Map<string, PlayerProp[]>();

export function cachedSimGames(sport: string): EspnGame[] {
  return gamesBySport.get(sport) ?? [];
}

export function rememberSimGames(sport: string, games: EspnGame[]): void {
  if (games.length > 0) gamesBySport.set(sport, games);
}

export function simPropsCacheKey(sport: string, gameId: string): string {
  return `${sport}:${gameId}`;
}

export function cachedSimProps(sport: string, gameId: string): PlayerProp[] {
  return propsByGame.get(simPropsCacheKey(sport, gameId)) ?? [];
}

export function rememberSimProps(sport: string, gameId: string, props: PlayerProp[]): void {
  if (props.length > 0) propsByGame.set(simPropsCacheKey(sport, gameId), props);
}
