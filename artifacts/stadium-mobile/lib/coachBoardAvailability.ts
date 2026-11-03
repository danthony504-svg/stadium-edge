import type { CoachScanFailureReason } from "./coachScanFailureReason.ts";

/** Counts only: never persist provider bodies, player records or error text. */
export type CoachBoardAvailability = {
  failedSports: number;
  receivedGames: number;
  startedGames: number;
  outsideHorizonGames: number;
  invalidStartGames: number;
  pregameGames: number;
};

export function summarizeCoachBoard(
  rows: readonly { commenceTime?: string }[], failedSports: number, now = Date.now(),
): CoachBoardAvailability {
  const counts: CoachBoardAvailability = { failedSports, receivedGames: rows.length,
    startedGames: 0, outsideHorizonGames: 0, invalidStartGames: 0, pregameGames: 0 };
  for (const row of rows) {
    const time = Date.parse(row.commenceTime ?? "");
    if (!Number.isFinite(time)) counts.invalidStartGames++;
    else if (time <= now) counts.startedGames++;
    else if (time >= now + 48 * 3600_000) counts.outsideHorizonGames++;
    else counts.pregameGames++;
  }
  return counts;
}

export function emptyCoachBoardReason(c: CoachBoardAvailability): CoachScanFailureReason | null {
  // Do not replace scope/market/quality diagnoses when pregame rows were loaded.
  if (c.pregameGames > 0) return null;
  if (c.failedSports > 0) return { code: "ODDS_BOARD_LOAD_FAILED",
    detail: `odds board request failed for ${c.failedSports} sport(s); usable availability unknown` };
  if (c.invalidStartGames > 0) return null;
  if (c.receivedGames > 0) return { code: "NO_UPCOMING_ODDS",
    detail: `loaded ${c.receivedGames} odds games; ${c.startedGames} started; ${c.outsideHorizonGames} outside 48h pregame horizon` };
  return null;
}
