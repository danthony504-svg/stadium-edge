import type { EspnGame, PlayerProp } from "./api";
import { isSimulatorEligible } from "./slate";

const gamesBySport = new Map<string, EspnGame[]>();
const propsByGame = new Map<string, PlayerProp[]>();

export function cachedSimGames(sport: string): EspnGame[] {
  // Re-filter on read — a game that was pregame when cached may have started since.
  return (gamesBySport.get(sport) ?? []).filter((g) => isSimulatorEligible(g));
}

export function rememberSimGames(sport: string, games: EspnGame[]): void {
  const eligible = games.filter((g) => isSimulatorEligible(g));
  if (eligible.length > 0) gamesBySport.set(sport, eligible);
  else gamesBySport.delete(sport);
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
