/** Additive wire contract; all consumers validate event identity and source age. */
import type { EspnGame, PropPoolEntry } from "./api.ts";
export type PreparedCoachGameContext = {
  version: 1; sport: string; eventId: string; startsAt: string; observedAtMs: number; expiresAtMs: number;
  homeTeamId: string; awayTeamId: string;
  lineups: Array<{ teamId: string; complete: boolean; players: Array<{ athleteId: string; starter: boolean; position: string | null; battingOrder: number | null }> }>;
  environment: { venue: string | null; exposure: "outdoor" | "indoors" | "unknown"; weather: {
    source: "openweather_forecast"; locationScope: "venue" | "city"; forecastAtMs: number; observedAtMs?: number;
    tempF: number | null; windMph: number | null; gustMph: number | null; windDeg: number | null; humidity: number | null; precipChancePct: number | null; condition: string | null;
  } | null };
};
export function preparedContextForGame(game: EspnGame, now = Date.now()): PreparedCoachGameContext | null {
  const c = game.preparedContext;
  if (!c || c.version !== 1 || c.sport !== game.sport || c.eventId !== game.id || c.homeTeamId !== game.homeTeamId || c.awayTeamId !== game.awayTeamId || Date.parse(c.startsAt) !== Date.parse(game.startsAt) || Date.parse(c.startsAt) <= now || !Number.isFinite(c.observedAtMs) || c.observedAtMs > now || !Number.isFinite(c.expiresAtMs) || c.expiresAtMs <= now || c.expiresAtMs > c.observedAtMs + 120_000) return null;
  return c;
}

/** Never infer bench status from missing lineup data or another game's lineup. */
export function preparedContextRejectsProp(entry: Pick<PropPoolEntry, "sport" | "marketKey" | "athleteId" | "playerTeamId" | "startsAt" | "game">, games: readonly EspnGame[]): boolean {
  const starterDependent = entry.sport === "mlb" ? /batter|total_bases|^hits$|^home_runs$/.test(entry.marketKey ?? "") : entry.sport === "soccer";
  if (!starterDependent || !entry.athleteId || !entry.startsAt) return false;
  const matches = games.filter(g => g.sport === entry.sport && Date.parse(g.startsAt) === Date.parse(entry.startsAt!) && (entry.playerTeamId ? [g.homeTeamId, g.awayTeamId].includes(entry.playerTeamId) : [g.name, g.shortName, `${g.awayTeam} @ ${g.homeTeam}`].includes(entry.game)));
  if (matches.length !== 1) return false;
  const context = preparedContextForGame(matches[0]!);
  const lineup = context?.lineups.find(l => entry.playerTeamId ? l.teamId === entry.playerTeamId : l.players.some(p => p.athleteId === entry.athleteId));
  return !!lineup?.complete && lineup.players.some(p => p.athleteId === entry.athleteId && p.starter === false);
}

/** Synchronous merge: no fetching, no simulation probability adjustment. */
export function preparedEnvironmentForGames(games: readonly EspnGame[], existing: Record<string, unknown> = {}): Record<string, unknown> {
  const result = { ...existing };
  for (const game of games) {
    const context = preparedContextForGame(game);
    if (!context || !context.environment || !["mlb", "nfl", "ncaaf", "soccer", "tennis"].includes(game.sport)) continue;
    const env = context.environment;
    const raw = env.weather;
    const weather = raw && raw.source === "openweather_forecast" && Math.abs(raw.forecastAtMs - Date.parse(game.startsAt)) <= 90 * 60_000 && raw.observedAtMs != null && raw.observedAtMs <= Date.now() && Date.now() - raw.observedAtMs <= 5 * 60_000 ? raw : null;
    const labels = [game.name, game.shortName, `${game.awayTeam} @ ${game.homeTeam}`, game.awayAbbr && game.homeAbbr ? `${game.awayAbbr} @ ${game.homeAbbr}` : null].filter((v): v is string => !!v);
    for (const label of labels) {
      const previous = result[label] as { park?: Record<string, unknown> } | undefined;
      result[label] = { ...previous, exposure: env.exposure, climateControlled: env.exposure === "indoors", park: { ...previous?.park, dome: env.exposure === "indoors" }, weather: env.exposure === "outdoor" ? weather : null, weatherLocationScope: weather?.locationScope ?? null, weatherForecastAtMs: weather?.forecastAtMs ?? null };
    }
  }
  return result;
}

/** Last delivery check, including recovery and alternate-line seats. */
export function filterPreparedDeliveryPicks<T extends { isProp?: boolean; sport?: string | null; game?: string | null; propMarketKey?: string | null; athleteId?: string | null; startsAt?: string | null }>(picks: T[], games: readonly EspnGame[]): T[] {
  return picks.filter(p => !p.isProp || !preparedContextRejectsProp({ sport: p.sport ?? "", game: p.game ?? "", marketKey: p.propMarketKey ?? undefined, athleteId: p.athleteId, startsAt: p.startsAt }, games));
}
