/** Posted binary props that do not carry a conventional O/U stat line. */
export const YES_NO_PROP_MARKETS = new Set([
  "batter_home_runs",
  "player_anytime_td",
  "player_goals",
  "player_goal_scorer_anytime",
]);

export function isYesNoPropMarket(marketKey: string | null | undefined): boolean {
  return YES_NO_PROP_MARKETS.has(String(marketKey ?? "").toLowerCase());
}

/**
 * Count simulations treat a posted “yes” outcome as exceeding 0.5. This is a
 * representation of the market event, not a fabricated sportsbook line.
 */
export function simulationLineForProp(
  marketKey: string | null | undefined,
  line: number | null | undefined,
): number | null {
  if (line != null && Number.isFinite(line)) return line;
  return isYesNoPropMarket(marketKey) ? 0.5 : null;
}
