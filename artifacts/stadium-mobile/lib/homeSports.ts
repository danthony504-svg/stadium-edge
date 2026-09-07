import type { Sport } from "./sports";

/** The explicit Home pill order. Never derive this from the catalog's order. */
export const HOME_SPORT_IDS = [
  "nfl",
  "ncaaf",
  "mlb",
  "nba",
  "wnba",
  "nhl",
  "soccer",
  "tennis",
  "ufc",
] as const;

/**
 * Resolves the exact array rendered by Home's sports-pill map.
 *
 * Iterating the desired IDs rather than filtering the global catalog makes
 * availability and catalog changes unable to reorder the rendered controls.
 */
export function homeSports(sports: readonly Sport[]): Sport[] {
  const byId = new Map(sports.map((sport) => [sport.id, sport]));
  return HOME_SPORT_IDS.flatMap((id) => {
    const sport = byId.get(id);
    return sport ? [sport] : [];
  });
}
