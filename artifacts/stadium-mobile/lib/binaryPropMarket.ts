/** Provider Yes/No markets may omit point; the settlement threshold is 0.5. */
const BINARY_MARKETS = new Set([
  "player_anytime_td", "player_first_td", "player_1st_td",
  "player_double_double", "player_triple_double", "player_goal_scorer_anytime", "player_first_goal_scorer",
  "anytime td", "first td", "anytime touchdown", "touchdown",
  "double-double", "double double", "triple-double", "triple double", "anytime goal", "first goal",
]);

export function isBinaryNullLineMarket(market: string | null | undefined): boolean {
  return BINARY_MARKETS.has(String(market ?? "").trim().toLowerCase());
}

/** Aggregate player game logs cannot determine the first scorer. */
export function requiresScoringOrder(market: string | null | undefined): boolean {
  return /^(?:player_(?:first_td|1st_td|first_goal_scorer))(?:_alternate)?$/i.test(String(market ?? ""));
}
