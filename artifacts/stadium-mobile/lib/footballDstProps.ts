/**
 * NFL D/ST player props from the Odds API (DraftKings D/ST tab family).
 * Fetched in an isolated API batch and hard-capped in deep-sim candidacy so
 * tackle/kicking volume cannot stretch the Coach delivery budget.
 */

export const FOOTBALL_DST_PROP_MARKET_KEYS = [
  "player_kicking_points",
  "player_tackles_assists",
  "player_solo_tackles",
  "player_defensive_interceptions",
] as const;

export type FootballDstPropMarketKey = (typeof FOOTBALL_DST_PROP_MARKET_KEYS)[number];

/** Max D/ST (non-sack) rows allowed in any deep-sim / props-only candidate set. */
export const FOOTBALL_DST_PROP_SIM_CAP = 8;

const DST_KEY_SET = new Set<string>(FOOTBALL_DST_PROP_MARKET_KEYS);

export function canonicalFootballMarketKey(market: string | null | undefined): string {
  let k = String(market ?? "").trim().toLowerCase();
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2)$/i, "");
  return k;
}

export function isFootballDstPropMarket(market: string | null | undefined): boolean {
  return DST_KEY_SET.has(canonicalFootballMarketKey(market));
}
