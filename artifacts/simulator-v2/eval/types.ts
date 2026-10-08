export type FootballSport = "nfl" | "ncaaf";

export type QuarterTuple = [number, number, number, number];

/** Completed game with verified final + quarter scores (ESPN linescores). */
export type HistoricalGame = {
  eventId: string;
  sport: FootballSport;
  season: number;
  week: number;
  seasonType: number;
  kickoffIso: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  /** Final score including OT. */
  homeFg: number;
  awayFg: number;
  /** Regulation quarters (first 4 linescores). */
  homeQuarters: QuarterTuple;
  awayQuarters: QuarterTuple;
  hadOt: boolean;
  /** Provenance. */
  source: "espn_scoreboard";
};

export type TeamForm = {
  teamId: string;
  gamesUsed: number;
  scoredByQuarter: QuarterTuple;
  allowedByQuarter: QuarterTuple;
  ptsFor: number;
  ptsAgainst: number;
  recentFgScores: number[];
};

export type EvalMarketKind =
  | "ml_home"
  | "spread_home"
  | "total_over"
  | "team_total_home_over"
  | "team_total_away_over";

export type EvalMarketSpec = {
  id: string;
  kind: EvalMarketKind;
  family: "ml" | "spread" | "total" | "team_total";
  period: "fg" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2";
  line?: number;
  /** For reporting extreme alts. */
  extreme?: boolean;
};

export type EngineName = "v2_joint" | "v1_frac" | "baseline_hist" | "baseline_coin";

export type EnginePrediction = {
  engine: EngineName;
  p: number;
  /** Predicted mean scores (FG / period) when applicable. */
  predHome?: number;
  predAway?: number;
  predTotal?: number;
  consistencyOk?: boolean;
  consistencyBreaks?: number;
};

export type MarketObservation = {
  eventId: string;
  sport: FootballSport;
  season: number;
  week: number;
  marketId: string;
  family: EvalMarketSpec["family"];
  period: EvalMarketSpec["period"];
  line?: number;
  extreme?: boolean;
  y: 0 | 1;
  engines: Record<EngineName, EnginePrediction>;
};

export type ScoreErrorRow = {
  eventId: string;
  sport: FootballSport;
  period: "fg" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2";
  engine: EngineName;
  absErrHome: number;
  absErrAway: number;
  absErrTotal: number;
  actualHome: number;
  actualAway: number;
  predHome: number;
  predAway: number;
};
