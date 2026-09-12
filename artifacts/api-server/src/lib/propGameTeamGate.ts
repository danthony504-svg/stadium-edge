/**
 * Gate Odds API player props to the requested game's home/away team ids.
 * Mirrors PrizePicks roster filtering: when ESPN team ids are known, drop
 * props whose playerTeamId is missing or not on either side of the matchup.
 */

export function propBelongsToGameTeams(
  playerTeamId: string | null | undefined,
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
): boolean {
  const home = String(homeTeamId ?? "").trim();
  const away = String(awayTeamId ?? "").trim();
  if (!home && !away) return true;
  const pt = String(playerTeamId ?? "").trim();
  if (!pt) return false;
  return pt === home || pt === away;
}
