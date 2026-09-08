/**
 * Fixed Discover / Home sport pill order.
 * Must stay independent of SPORTS catalog order (football was appended there for
 * Coach/Simulator), API response order, and sport availability.
 */
export const HOME_SPORT_IDS = [
  "mlb",
  "nfl",
  "ncaaf",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "tennis",
  "ufc",
] as const;

export type HomeSportId = (typeof HOME_SPORT_IDS)[number];

export function buildHomeSports<T extends { id: string }>(catalog: readonly T[]): T[] {
  return HOME_SPORT_IDS.map((id) => {
    const sport = catalog.find((s) => s.id === id);
    if (!sport) throw new Error(`HOME_SPORT_IDS references unknown sport: ${id}`);
    return sport;
  });
}
