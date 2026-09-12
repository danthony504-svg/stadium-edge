/**
 * Gate player props to the labeled game's home/away teams.
 *
 * Odds `/sports/props` rows are fetched per eventId, then labeled with that
 * event's matchup string. Orphan / cross-event players (null or foreign
 * playerTeamId) must not inherit "Away @ Home" — that is how Aaron Rodgers
 * Rush Yds can land on Atlanta Falcons @ Pittsburgh Steelers when he is not
 * on either roster id for that request.
 *
 * Fail closed always for labeled Coach board props:
 * - missing / non-matching playerTeamId → drop
 * - missing home+away ESPN ids → drop (cannot prove membership; fail-open
 *   previously stamped orphan Odds rows with Away @ Home)
 */

export function propBelongsToGameTeams(
  playerTeamId: string | null | undefined,
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
): boolean {
  const home = String(homeTeamId ?? "").trim();
  const away = String(awayTeamId ?? "").trim();
  if (!home && !away) return false;
  const pt = String(playerTeamId ?? "").trim();
  if (!pt) return false;
  return pt === home || pt === away;
}

/** Filter prop-like rows that carry optional playerTeamId. */
export function filterPropsForGameTeams<T extends { playerTeamId?: string | null }>(
  props: T[],
  homeTeamId: string | null | undefined,
  awayTeamId: string | null | undefined,
): T[] {
  return props.filter((p) =>
    propBelongsToGameTeams(p.playerTeamId, homeTeamId, awayTeamId),
  );
}
