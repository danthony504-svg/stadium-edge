// Sport-specific simulation model metadata — maps each sport to its engine.

export type SportSimModelId =
  | "mlb-inning"
  | "nba-possession"
  | "wnba-possession"
  | "nfl-drive"
  | "nhl-shift"
  | "soccer-xg"
  | "tennis-point"
  | "ufc-round"
  | "generic-team"
  | "player-prop";

const LABELS: Record<SportSimModelId, string> = {
  "mlb-inning": "MLB inning-by-inning (run expectancy + bullpen fatigue)",
  "nba-possession": "NBA possession-by-possession (pace + fouls)",
  "wnba-possession": "WNBA possession-by-possession (pace + fouls)",
  "nfl-drive": "NFL drive-by-drive (play calling + clock)",
  "nhl-shift": "NHL shift-by-shift (goalie performance)",
  "soccer-xg": "Soccer xG + possession model",
  "tennis-point": "Tennis point → game → set → match",
  "ufc-round": "UFC/MMA strike/takedown/sub round model",
  "generic-team": "Generic team scoring model",
  "player-prop": "Player prop Monte Carlo (game-log samples)",
};

export function sportSimModelForSport(sport: string): SportSimModelId {
  const s = sport.toLowerCase();
  if (s === "mlb") return "mlb-inning";
  if (s === "nba") return "nba-possession";
  if (s === "wnba") return "wnba-possession";
  if (s === "nfl" || s === "ncaaf") return "nfl-drive";
  if (s === "nhl") return "nhl-shift";
  if (s === "soccer") return "soccer-xg";
  if (s === "tennis") return "tennis-point";
  if (s === "ufc" || s === "mma") return "ufc-round";
  return "generic-team";
}

export function sportSimModelLabel(sport: string, isProp?: boolean): string {
  if (isProp) return LABELS["player-prop"];
  return LABELS[sportSimModelForSport(sport)] ?? LABELS["generic-team"];
}

export const MIN_SIM_DRAWS = 10_000;
