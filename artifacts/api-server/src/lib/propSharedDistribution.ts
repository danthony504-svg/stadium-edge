/**
 * Shared prop Monte Carlo distribution keys.
 * Compatible alt rungs (same event/player/stat/period/context) share one 10k draw.
 * Period must remain in the market key — FG yards must never share with Q1 yards.
 */

/** Strip only `_alternate`; keep period suffixes (q1/h1/f5/…). */
export function propSharedDistributionMarketKey(market: string | null | undefined): string {
  let k = String(market ?? "").trim().toLowerCase();
  if (!k) return "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  return k;
}

export type PropSharedDistributionParts = {
  sport: string;
  player: string;
  market: string;
  athleteId?: string | null;
  opponentTeamId?: string | null;
  isHome?: boolean | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  oppPace?: number | null;
  leaguePace?: number | null;
  oppKeyInjuries?: number | null;
  ownKeyInjuries?: number | null;
  weatherImpact?: number | null;
  /** Compact Opportunity Shift table fingerprint (family mults). */
  opportunityShiftFingerprint?: string | null;
  /**
   * Effective Opponent Matchup defense index for this market family.
   * Null/missing must serialize differently from a supplied ~1.0 value.
   */
  defenseIndex?: number | null;
  /** QB←WR receiving coupling factor when applicable; null when absent. */
  coupledReceivingMatchup?: number | null;
};

/**
 * Identity of the underlying stat distribution (NOT line/side).
 * Two requests may share a draw only when this key matches.
 */
export function propSharedDistributionKey(parts: PropSharedDistributionParts): string {
  const sport = String(parts.sport ?? "").toLowerCase();
  const player = String(parts.player ?? "").toLowerCase().trim();
  const market = propSharedDistributionMarketKey(parts.market);
  const home =
    parts.isHome === true ? "H" : parts.isHome === false ? "A" : "U";
  const pace = (n: number | null | undefined) =>
    n != null && Number.isFinite(n) ? n.toFixed(2) : "";
  const wx = (n: number | null | undefined) =>
    n != null && Number.isFinite(n) ? n.toFixed(3) : "";
  /** Empty when null/undefined — never collide with an explicit finite value. */
  const idx = (n: number | null | undefined) =>
    n != null && Number.isFinite(n) ? n.toFixed(4) : "";
  return [
    sport,
    player,
    market,
    String(parts.athleteId ?? ""),
    String(parts.opponentTeamId ?? ""),
    home,
    String(parts.homeTeamId ?? ""),
    String(parts.awayTeamId ?? ""),
    pace(parts.oppPace),
    pace(parts.leaguePace),
    String(parts.oppKeyInjuries ?? 0),
    String(parts.ownKeyInjuries ?? 0),
    wx(parts.weatherImpact),
    String(parts.opportunityShiftFingerprint ?? ""),
    idx(parts.defenseIndex),
    idx(parts.coupledReceivingMatchup),
  ].join("|");
}
