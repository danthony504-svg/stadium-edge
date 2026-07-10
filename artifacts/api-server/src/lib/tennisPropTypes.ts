// Shared types for the tennis player-prop engine (stats vendor + prop odds vendor).

export type TennisSurface = "hard" | "clay" | "grass" | "indoor_hard" | "unknown";

export type TennisPropMarketKey =
  | "player_aces"
  | "player_games_won"
  | "player_total_games"
  | "player_double_faults"
  | "player_breaks"
  | "player_first_serve_pct"
  | "player_sets_won";

/** One posted prop rung from a sportsbook (main or alt). */
export type TennisPropLine = {
  eventId: string;
  matchLabel: string; // "Away @ Home"
  awayPlayer: string;
  homePlayer: string;
  player: string;
  market: TennisPropMarketKey;
  marketLabel: string;
  line: number | null;
  side: "Over" | "Under" | "Yes" | "No";
  odds: number;
  book: string;
  alt: boolean;
  commenceTime?: string | null;
};

/** Per-match stat profile used to drive Monte Carlo (null = honest missing). */
export type TennisPlayerStatProfile = {
  name: string;
  resolvedName: string | null;
  athleteId: string | null;
  rank: number | null;
  surfaceWinPct: Partial<Record<TennisSurface, number | null>>;
  recentFormWins: number;
  recentFormLosses: number;
  /** Per-match stat averages from stats vendor (last 5–10). */
  servePct: number | null;
  firstServeWonPct: number | null;
  secondServeWonPct: number | null;
  returnPtsWonPct: number | null;
  acesPerMatch: number | null;
  doubleFaultsPerMatch: number | null;
  breakPtsSavedPct: number | null;
  breakPtsConvertedPct: number | null;
  tiebreakWinPct: number | null;
  matchesLast14Days: number | null;
  hoursPlayedLast14Days: number | null;
  daysSinceLastMatch: number | null;
  injuryFlag: boolean | null;
  indoorWinPct: number | null;
  outdoorWinPct: number | null;
};

export type TennisMatchPropContext = {
  matchLabel: string;
  awayPlayer: string;
  homePlayer: string;
  surface: TennisSurface;
  indoor: boolean | null;
  tournament: string | null;
  round: string | null;
  away: TennisPlayerStatProfile;
  home: TennisPlayerStatProfile;
  h2hAwayWins: number | null;
  h2hHomeWins: number | null;
  weatherWindMph: number | null;
  weatherHeatIndex: number | null;
  weatherHumidityPct: number | null;
};

export type TennisPropSimResult = {
  simulations: number;
  hitProbability: number | null;
  meanProjection: number | null;
  confidenceScore: number | null;
  lineHitRates?: Record<string, number>;
};

export type TennisPropGrade = {
  edgePct: number | null;
  evPct: number | null;
  fairProb: number | null;
  simHit: number | null;
  composite: number | null;
  grade: string | null;
  confidencePct: number | null;
  recommends: boolean;
  skipReason: string | null;
};

export type TennisPropRecommendation = {
  line: TennisPropLine;
  sim: TennisPropSimResult;
  grade: TennisPropGrade;
  /** Learning-adjusted composite (past tennis prop hit rates). */
  adjustedComposite: number | null;
  rankScore: number | null;
};

export type TennisPropEngineResult = {
  matchLabel: string;
  analyzed: number;
  recommended: TennisPropRecommendation[];
  skipped: Array<{ line: TennisPropLine; grade: TennisPropGrade }>;
  vendorStatus: {
    propsAvailable: boolean;
    statsComplete: boolean;
    message: string | null;
  };
};
