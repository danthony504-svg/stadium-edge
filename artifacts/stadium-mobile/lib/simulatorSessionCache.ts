import type { EspnGame, PlayerProp } from "./api";
import { isSimulatorPregame } from "./simulatorApi";
import { isUfcFightRow } from "./ufcSimulatorGames";

const gamesBySport = new Map<string, EspnGame[]>();
const propsByGame = new Map<string, PlayerProp[]>();

function eligibleGames(sport: string, games: EspnGame[]): EspnGame[] {
  return games.filter((g) => {
    if (!isSimulatorPregame(g)) return false;
    if ((sport === "ufc" || sport === "mma") && !isUfcFightRow(g)) return false;
    return true;
  });
}

/** Drop started/final games from every sport bucket (e.g. on tab focus). */
export function pruneSimGamesCache(): void {
  for (const [sport, games] of gamesBySport.entries()) {
    const kept = eligibleGames(sport, games);
    if (kept.length > 0) gamesBySport.set(sport, kept);
    else gamesBySport.delete(sport);
  }
}

export function cachedSimGames(sport: string): EspnGame[] {
  // Re-filter on read — a game that was pregame when cached may have started since.
  return eligibleGames(sport, gamesBySport.get(sport) ?? []);
}

export function rememberSimGames(sport: string, games: EspnGame[]): void {
  const eligible = eligibleGames(sport, games);
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
