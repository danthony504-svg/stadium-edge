// Sport-specific game simulation inputs — shared contract for every engine.

import type {
  GameCoverQuery,
  GameSimDefenseAllowed,
  GameSimTeamInput,
} from "../gameMonteCarlo.js";

export type { GameSimDefenseAllowed };

export type SportSimContext = {
  sport: string;
  simulations?: number;
  home: GameSimTeamInput;
  away: GameSimTeamInput;
  weatherImpact?: number | null;
  coverQueries?: GameCoverQuery[];
  retainOutcomes?: boolean;
  /** When set, drive sims draw from this stream so a holdout can be replayed. */
  random?: () => number;
  /**
   * NCAAF research-only residual + home-margin shrink (v1.1-research).
   * Must stay unset/false on the live NFL and product NCAAF path so the
   * verified `ppg-per-drive-v1` stamp and draws are unchanged.
   */
  ncaafResearchCalibration?: boolean;
};

export type SportSimModelId =
  | "mlb-inning"
  | "nba-possession"
  | "wnba-possession"
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
