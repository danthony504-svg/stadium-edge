/**
 * Build NFL/NCAAF GameSimTeamInput rows: venue/L10 blend + defense packs.
 */

import type { GameSimDefenseAllowed, GameSimTeamInput } from "../gameMonteCarlo.js";
import { computeFootballDefenseAllowed } from "../rushDefenseAllowed.js";
import { blendVenueAndL10, type FormSlice } from "./footballDriveMatchup.js";

export type TeamHistoryForm = {
  homeSplit?: FormSlice;
  awaySplit?: FormSlice;
  last10?: FormSlice;
  recent?: Array<{ pts?: number | null }>;
};

function recentScores(hist: TeamHistoryForm | null | undefined): number[] {
  return (hist?.recent ?? [])
    .map((g) => g.pts)
    .filter((v): v is number => v != null && Number.isFinite(v));
}

export function teamInputFromHistory(
  hist: TeamHistoryForm | null | undefined,
  venue: "home" | "away",
  defenseAllowed?: GameSimDefenseAllowed | null,
): GameSimTeamInput {
  const venueSlice = venue === "home" ? hist?.homeSplit : hist?.awaySplit;
  const blended = blendVenueAndL10(venueSlice, hist?.last10);
  return {
    ptsFor: blended.ptsFor,
    ptsAgainst: blended.ptsAgainst,
    recentScores: recentScores(hist),
    defenseAllowed: defenseAllowed ?? null,
  };
}

export async function loadFootballDefenseAllowed(
  sport: string,
  teamId: string,
): Promise<GameSimDefenseAllowed | null> {
  const s = String(sport ?? "").toLowerCase();
  if (s !== "nfl" && s !== "ncaaf" && s !== "cfb") return null;
  if (!teamId) return null;
  try {
    const pack = await computeFootballDefenseAllowed(s === "cfb" ? "ncaaf" : s, teamId, {
      maxGames: 5,
    });
    return {
      rushingYardsAllowedPerGame: pack.rush.rushingYardsAllowedPerGame,
      passingYardsAllowedPerGame: pack.pass.passingYardsAllowedPerGame,
      rushSampleSize: pack.rush.sampleSize,
      passSampleSize: pack.pass.sampleSize,
    };
  } catch {
    return null;
  }
}

export function wantsFootballDefensePacks(sport: string): boolean {
  const s = String(sport ?? "").toLowerCase();
  return s === "nfl" || s === "ncaaf" || s === "cfb";
}
