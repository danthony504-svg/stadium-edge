/**
 * Shared prop Monte Carlo distribution keys (Phase 1).
 * Compatible alt rungs (same event/player/stat/period/context) share one draw.
 * Period must remain in the market key — FG yards must never share with Q1 yards.
 */

/** Strip only `_alternate`; keep period suffixes (q1/h1/f5/…). */
export function propSharedDistributionMarketKey(market: string | null | undefined): string {
  let k = String(market ?? "").trim().toLowerCase();
  if (!k) return "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  return k;
}

/** True when two provider market keys share one underlying stat distribution. */
export function propMarketsShareDistribution(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = propSharedDistributionMarketKey(a);
  const kb = propSharedDistributionMarketKey(b);
  return !!ka && ka === kb;
}
