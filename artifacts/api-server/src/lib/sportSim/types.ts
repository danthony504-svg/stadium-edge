// Sport-specific game simulation inputs — shared contract for every engine.

import type { GameCoverQuery, GameSimTeamInput } from "../gameMonteCarlo.js";

export type SportSimContext = {
  sport: string;
  simulations?: number;
  home: GameSimTeamInput;
  away: GameSimTeamInput;
  weatherImpact?: number | null;
  coverQueries?: GameCoverQuery[];
  retainOutcomes?: boolean;
};

export type SportSimModelId =
  | "mlb-inning"
  | "nba-score-v2"
  | "wnba-score-v2"
  | "ncaab-score-v2"
  | "nfl-drive"
  | "nhl-shift"
  | "soccer-xg"
  | "tennis-point"
  | "ufc-round"
  | "generic-team";

export type SportSimResultMeta = {
  simModel: SportSimModelId;
  simModelLabel: string;
};
