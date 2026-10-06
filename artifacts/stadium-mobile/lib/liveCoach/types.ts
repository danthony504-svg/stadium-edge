/**
 * Live Coach Phase 1 — types only.
 * No recommendation / simulation / qualification thresholds.
 */

export type LiveFreshnessStatus = "fresh" | "stale" | "unknown";

export type LiveMarketStatus = "open" | "suspended" | "closed" | "unknown";

/** Scoreboard / game-state snapshot keyed by ESPN eventId. */
export type LiveGameStateRecord = {
  eventId: string;
  sport: string;
  awayTeam: string;
  homeTeam: string;
  matchup: string;
  awayScore: number | null;
  homeScore: number | null;
  state: string;
  period: number | null;
  periodLabel: string | null;
  clock: string | null;
  fetchedAt: string | null;
};

/** Live sportsbook quote — must carry eventId when available. */
export type LivePriceRecord = {
  eventId: string | null;
  sport: string;
  matchup: string;
  market: string;
  pick: string;
  line: number | null;
  price: number;
  source: string | null;
  /** Provider-native timestamp when genuinely available; never fabricated. */
  providerLastUpdate: string | null;
  /** Server assembly time — distinct from providerLastUpdate. */
  fetchedAt: string | null;
  marketStatus?: LiveMarketStatus | null;
  /** Game state observed when the quote was captured (for race detection). */
  quoteGameState?: Partial<
    Pick<
      LiveGameStateRecord,
      "awayScore" | "homeScore" | "period" | "periodLabel" | "clock" | "state"
    >
  > | null;
};

export type NormalizedLiveMarket = {
  eventId: string;
  sport: string;
  matchup: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  state: string;
  period: number | null;
  periodLabel: string | null;
  clock: string | null;
  source: string | null;
  market: string;
  pick: string;
  line: number | null;
  price: number;
  providerLastUpdate: string | null;
  fetchedAt: string | null;
  freshness: LiveFreshnessStatus;
  ageMs: number | null;
  marketStatus: LiveMarketStatus;
  /** True when scoreboard advanced past the quote's captured state. */
  gameStateAdvanced: boolean;
  /** True when quote is unsafe to recommend (stale / advanced / suspended / closed). */
  unsafe: boolean;
  unsafeReasons: string[];
};

export type LiveBoardDiagnosticRow = {
  eventId: string;
  matchup: string;
  score: string;
  period: string;
  clock: string;
  priceSource: string;
  market: string;
  line: string;
  price: string;
  providerTimestamp: string;
  fetchedAt: string;
  ageStatus: string;
};
