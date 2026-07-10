import type { OddsGame, EspnGame } from "./api";

/** Generation-tagged odds/games payload used on Home to block cross-league bleed. */
export type SportFeedPayload<T> = { gen: number; league: string; rows: T[] };

export function isSportFeedPayload<T>(v: unknown): v is SportFeedPayload<T> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof (v as SportFeedPayload<T>).gen === "number" &&
    typeof (v as SportFeedPayload<T>).league === "string" &&
    Array.isArray((v as SportFeedPayload<T>).rows)
  );
}

/** Normalize react-query cache data from Home (payload) or Upcoming (plain array). */
export function oddsRowsFromQuery(data: unknown, sport: string): OddsGame[] {
  if (isSportFeedPayload<OddsGame>(data)) {
    if (data.league !== sport) return [];
    return data.rows.filter((g) => !g.sport || g.sport === sport);
  }
  if (Array.isArray(data)) {
    return data.filter(
      (g): g is OddsGame =>
        !!g &&
        typeof g === "object" &&
        typeof (g as OddsGame).id === "string" &&
        (!g.sport || g.sport === sport),
    );
  }
  return [];
}

export function espnRowsFromQuery(data: unknown, sport: string): EspnGame[] {
  if (isSportFeedPayload<EspnGame>(data)) {
    if (data.league !== sport) return [];
    return data.rows.filter((g) => g.sport === sport);
  }
  if (Array.isArray(data)) {
    return data.filter(
      (g): g is EspnGame =>
        !!g &&
        typeof g === "object" &&
        typeof (g as EspnGame).id === "string" &&
        (g as EspnGame).sport === sport,
    );
  }
  return [];
}

/** Drop odds rows that are missing the fields GameCard needs to render safely. */
export function isRenderableOddsGame(g: OddsGame): boolean {
  return (
    typeof g.id === "string" &&
    g.id.length > 0 &&
    typeof g.awayTeam === "string" &&
    g.awayTeam.length > 0 &&
    typeof g.homeTeam === "string" &&
    g.homeTeam.length > 0 &&
    typeof g.commenceTime === "string" &&
    g.commenceTime.length > 0 &&
    Array.isArray(g.markets)
  );
}
