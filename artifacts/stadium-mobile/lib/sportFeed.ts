import type { OddsGame, EspnGame, OddsMarket } from "./api";

/** Odds API rows should carry markets[]; guard corrupt/partial cache entries. */
export function safeMarkets(g: Pick<OddsGame, "markets"> | null | undefined): OddsMarket[] {
  const m = g?.markets;
  return Array.isArray(m) ? m : [];
}

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

/**
 * True when Home can paint this league's odds/games from a settled success
 * payload for the active sport-switch generation.
 *
 * Do NOT gate on react-query `isFetching`: focus/refetch invalidations used to
 * clear Upcoming to [] and leave "Loading live odds…" up for the whole refetch,
 * which looked like a hung Home even when the network was fine.
 */
export function isCurrentSportFeedReady<T>(opts: {
  data: unknown;
  sport: string;
  gen: number;
  isSuccess: boolean;
  isPlaceholderData?: boolean;
}): opts is {
  data: SportFeedPayload<T>;
  sport: string;
  gen: number;
  isSuccess: true;
  isPlaceholderData?: boolean;
} {
  if (!opts.isSuccess || opts.isPlaceholderData) return false;
  if (!isSportFeedPayload<T>(opts.data)) return false;
  return opts.data.league === opts.sport && opts.data.gen === opts.gen;
}

/** Normalize react-query cache data from Home (payload) or Upcoming (plain array). */
export function oddsRowsFromQuery(data: unknown, sport: string): OddsGame[] {
  if (data == null) return [];
  if (isSportFeedPayload<OddsGame>(data)) {
    if (data.league !== sport) return [];
    return data.rows.filter((g) => g && (!g.sport || g.sport === sport));
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
  if (data == null) return [];
  if (isSportFeedPayload<EspnGame>(data)) {
    if (data.league !== sport) return [];
    return data.rows.filter((g) => g && g.sport === sport);
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

export function oddsPayloadFromQuery(data: unknown, sport: string): SportFeedPayload<OddsGame> {
  return {
    gen: isSportFeedPayload<OddsGame>(data) ? data.gen : 0,
    league: sport,
    rows: oddsRowsFromQuery(data, sport).filter(isRenderableOddsGame),
  };
}

export function espnPayloadFromQuery(data: unknown, sport: string): SportFeedPayload<EspnGame> {
  return {
    gen: isSportFeedPayload<EspnGame>(data) ? data.gen : 0,
    league: sport,
    rows: espnRowsFromQuery(data, sport),
  };
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
