/**
 * Period vs full-game market guards.
 * Full-game projections must not ingest first-half / quarter period series.
 */

/** Underscored tokens so `player_pass_yds_1h` matches (word-boundary fails on `_1h`). */
const PERIOD_TOKEN_RE =
  /(^|_)(1h|2h|h1|h2|1st_half|2nd_half|first_half|second_half|q1|q2|q3|q4|period_1|period_2|period_3|p1|p2|p3|f5|1q|2q|3q|4q)(_|$)/i;

function normalizeMarketKey(market: string): string {
  return market.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/** True when the market string itself is a period market. */
export function isPeriodMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "").toLowerCase();
  if (!m) return false;
  return PERIOD_TOKEN_RE.test(normalizeMarketKey(m));
}

/** Full-game markets are anything that is not explicitly a period market. */
export function isFullGameMarket(market: string | null | undefined): boolean {
  return !isPeriodMarket(market);
}

/**
 * Filter a numeric series that may be paired with period tags.
 * When projecting a full-game market, drop values tagged as period.
 * Tags default to "full" when absent.
 */
export function filterSeriesForMarket(
  market: string,
  values: readonly number[],
  tags?: readonly (string | null | undefined)[] | null,
): number[] {
  if (!isFullGameMarket(market) || !tags || tags.length === 0) {
    return values.filter((v) => Number.isFinite(v)) as number[];
  }
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const tag = normalizeMarketKey(String(tags[i] ?? "full"));
    if (PERIOD_TOKEN_RE.test(tag)) continue;
    out.push(v as number);
  }
  return out;
}
