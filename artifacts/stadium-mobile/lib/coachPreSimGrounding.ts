/** Reject known bad or unidentified player-game rows before expensive Coach simulation. */
import type { EspnGame, PropPoolEntry } from "./api.ts";
import { pickHasPlayerGameGroundingMismatch } from "./coachReliabilityGrounding.ts";

export function filterUngroundedCoachPropPool<T extends PropPoolEntry>(entries: readonly T[], games: readonly EspnGame[] = []): T[] {
  return entries.filter((entry) => {
    // Never simulate a named player against a known game if their team is unknown.
    // The final ticket belt remains an independent defense.
    if (entry.player?.trim() && entry.game?.trim() && !entry.teamAbbr?.trim()) return false;
    // Authoritative ESPN game team IDs, when available, outrank the display
    // abbreviation. Ambiguous game labels are not used for identity inference.
    const matchingGames = games.filter((g) =>
      g.sport?.toLowerCase() === entry.sport?.toLowerCase() &&
      [g.name, g.shortName].some((n) => String(n ?? "").trim().toLowerCase() === entry.game.trim().toLowerCase()),
    );
    const ownTeamId = String(entry.playerTeamId ?? "").trim();
    if (ownTeamId && matchingGames.length === 1) {
      const game = matchingGames[0]!;
      const home = String(game.homeTeamId ?? "").trim();
      const away = String(game.awayTeamId ?? "").trim();
      if (home && away && ownTeamId !== home && ownTeamId !== away) return false;
    }
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
