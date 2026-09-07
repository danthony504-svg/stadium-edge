import type { EspnGame } from "./api";
import type { SportFeedPayload } from "./sportFeed";

const FINAL_STATUS = /\b(final|completed|postponed|cancell?ed)\b/i;

/** A Home live card must be an in-progress row from the current provider result. */
export function isCurrentHomeLiveGame(game: EspnGame, sport: string): boolean {
  return game.sport === sport && game.state === "in" && !FINAL_STATUS.test(game.status);
}

/**
 * Derives the exact Live Now array from the active sport's latest provider
 * payload. Persisted Discover snapshots are intentionally not an input.
 */
export function homeLiveGames(
  payload: SportFeedPayload<EspnGame> | undefined,
  sport: string,
  currentGeneration: number,
): EspnGame[] {
  if (
    !payload ||
    payload.league !== sport ||
    payload.gen !== currentGeneration ||
    !Array.isArray(payload.rows)
  ) {
    return [];
  }
  return payload.rows.filter((game) => isCurrentHomeLiveGame(game, sport));
}
