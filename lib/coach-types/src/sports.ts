/**
 * Canonical sport identifiers. New sports are added here and via a sport adapter module —
 * the core engine never branches on sport strings inline.
 */
export const COACH_SPORT_IDS = [
  "mlb",
  "nba",
  "nfl",
  "nhl",
  "wnba",
  "soccer",
  "tennis",
  "mma",
  "golf",
  "nascar",
  "ncaaf",
  "ncaab",
  "ncaaw",
] as const;

export type CoachSportId = (typeof COACH_SPORT_IDS)[number];

/** Future sports register at runtime; known ids are listed above. */
export type CoachSportIdOrCustom = CoachSportId | (string & {});

export type SimModelKind =
  | "possession"
  | "inning"
  | "drive"
  | "shift"
  | "xg"
  | "set"
  | "round"
  | "lap"
  | "hole"
  | "generic";

export type GameMarketKind =
  | "moneyline"
  | "spread"
  | "total"
  | "team_total"
  | "period_moneyline"
  | "period_spread"
  | "period_total"
  | "custom";

export type PropMarketKind =
  | "player_stat"
  | "player_combo"
  | "team_stat"
  | "game_prop"
  | "custom";

export type GameMarketDefinition = {
  kind: GameMarketKind;
  marketKey: string;
  displayLabel: string;
  supportsAlts: boolean;
  simModel: SimModelKind;
};

export type PropMarketDefinition = {
  kind: PropMarketKind;
  marketKey: string;
  displayLabel: string;
  supportsAlts: boolean;
  simModel: SimModelKind;
};
