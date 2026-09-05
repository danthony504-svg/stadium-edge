import type { FantasyScoringFormat } from "@/lib/fantasyScoring";

export const FANTASY_ROSTER_SLOTS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "K",
  "DEF",
  "Bench",
  "IR",
] as const;

export type FantasyRosterSlot = (typeof FANTASY_ROSTER_SLOTS)[number];

export type FantasyRosterPlayer = {
  athleteId: string;
  name: string;
  team: string | null;
  /** Kept when the player search feed supplies it; never used as a projection. */
  position?: string | null;
  headshot?: string | null;
  rosterSlot: FantasyRosterSlot;
  dateAdded: number;
};

export type FantasyRoster = {
  id: string;
  name: string;
  sport: "nfl";
  scoringFormat: FantasyScoringFormat;
  players: FantasyRosterPlayer[];
  updatedAt: number;
};

/** Versioned container leaves room for ESPN/Yahoo/Sleeper rosters later. */
export type FantasyRostersSync = {
  version: 1;
  defaultRosterId: string;
  rosters: Record<string, FantasyRoster>;
};

export const DEFAULT_FANTASY_ROSTER_ID = "default";

export function createDefaultFantasyRosters(): FantasyRostersSync {
  const now = Date.now();
  return {
    version: 1,
    defaultRosterId: DEFAULT_FANTASY_ROSTER_ID,
    rosters: {
      [DEFAULT_FANTASY_ROSTER_ID]: {
        id: DEFAULT_FANTASY_ROSTER_ID,
        name: "My Fantasy Team",
        sport: "nfl",
        scoringFormat: "ppr",
        players: [],
        updatedAt: now,
      },
    },
  };
}

export function defaultFantasyRoster(data: FantasyRostersSync): FantasyRoster {
  return data.rosters[data.defaultRosterId] ?? createDefaultFantasyRosters().rosters.default!;
}
