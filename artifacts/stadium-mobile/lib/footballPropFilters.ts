// Football Simulator prop categories — Popular | Passing | Rushing | Receiving | TDs.
//
// Every market listed here is posted by the provider with a real line and has a
// stat mapping in propStats.ts, so a row reached through a pill can actually be
// simulated and graded. Two football markets are deliberately absent:
//
//   - player_anytime_td is posted WITHOUT a line, so the Simulator's mains
//     filter drops it before any pill runs. Giving it a pill would show an empty
//     category and imply it is simulated when no stat path has been verified.
//   - player_sacks maps to the ESPN "SACKS" label, which on an offensive game
//     log means times-sacked rather than sacks recorded. It stays reachable from
//     Popular and search rather than being promoted to a category.
//
// Period variants (player_pass_yds_q1, player_rush_yds_h1, ...) are also left to
// Popular: they carry lines but no period-scoped stat mapping, and the provider
// posts only a handful per game.

export const FOOTBALL_PASSING_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_attempts",
  "player_pass_completions",
  "player_pass_interceptions",
  "player_pass_longest_completion",
];

export const FOOTBALL_RUSHING_MARKETS = [
  "player_rush_yds",
  "player_rush_attempts",
  "player_rush_longest",
];

export const FOOTBALL_RECEIVING_MARKETS = [
  "player_reception_yds",
  "player_receptions",
  "player_reception_longest",
];

/** Only passing TDs carry a line; anytime TD is priced without one. */
export const FOOTBALL_TD_MARKETS = ["player_pass_tds"];

export type FootballPropFilterGroup = {
  id: string;
  label: string;
  icon?: "zap";
  markets?: string[];
};

export const FOOTBALL_PROP_FILTER_GROUPS: FootballPropFilterGroup[] = [
  { id: "popular", label: "Popular", icon: "zap" },
  { id: "passing", label: "Passing", markets: FOOTBALL_PASSING_MARKETS },
  { id: "rushing", label: "Rushing", markets: FOOTBALL_RUSHING_MARKETS },
  { id: "receiving", label: "Receiving", markets: FOOTBALL_RECEIVING_MARKETS },
  { id: "tds", label: "TDs", markets: FOOTBALL_TD_MARKETS },
];
