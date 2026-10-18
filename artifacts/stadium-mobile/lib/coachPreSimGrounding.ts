/** Reject known bad or unidentified player-game rows before expensive Coach simulation. */
import type { PropPoolEntry } from "./api.ts";
import { pickHasPlayerGameGroundingMismatch } from "./coachReliabilityGrounding.ts";

export function filterUngroundedCoachPropPool<T extends PropPoolEntry>(entries: readonly T[]): T[] {
  return entries.filter((entry) => {
    // Never simulate a named player against a known game if their team is unknown.
    // The final ticket belt remains an independent defense.
    if (entry.player?.trim() && entry.game?.trim() && !entry.teamAbbr?.trim()) return false;
    return !pickHasPlayerGameGroundingMismatch({
      game: entry.game,
      teamAbbr: entry.teamAbbr,
      player: entry.player,
      sport: entry.sport,
      isProp: true,
      propMarketKey: entry.marketKey,
    });
  });
}
