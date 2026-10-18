/**
 * Release acceptance gate for historical NCAAF game lines.
 * This is intentionally fail closed. Synthetic seeded unit tests cannot certify a
 * betting model without a dated, independent closing-line holdout.
 */
export type HistoricalNcaafGame = {
  gameId: string;
  season: number;
  playedAt: string;
  homeScore: number;
  awayScore: number;
  closingHomeSpread: number;
  closingHomePrice: number;
  closingAwayPrice: number;
  predictedHomeCoverProbability: number;
  predictedHomeWinProbability: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  injurySourceTimestamp: string | null;
  source: string;
};
export type HistoricalAcceptance = {
  eligible: boolean;
  reasons: string[];
  sampleSize: number;
  brierHomeCover: number | null;
  scoreMeanAbsoluteError: number | null;
};
const validProbability = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
export function evaluateHistoricalNcaafAcceptance(
  games: HistoricalNcaafGame[],
  opts: { marketBaselineBrier?: number; minimumHoldoutGames?: number; independentHoldoutVerified?: boolean; exactLineBindingVerified?: boolean; injuryConservatismVerified?: boolean; humanSignoff?: boolean } = {},
): HistoricalAcceptance {
  const reasons: string[] = [];
  if (opts.independentHoldoutVerified !== true) reasons.push("holdout_provenance_unverified");
  if (opts.exactLineBindingVerified !== true) reasons.push("exact_line_binding_unverified");
  if (opts.injuryConservatismVerified !== true) reasons.push("injury_conservatism_unverified");
  if (opts.humanSignoff !== true) reasons.push("human_signoff_required");
  const minimum = opts.minimumHoldoutGames ?? 500;
  if (games.length < minimum) reasons.push("insufficient_independent_holdout");
  if (new Set(games.map(g => g.gameId)).size !== games.length) reasons.push("duplicate_game_ids");
  if (new Set(games.map(g => g.season)).size < 2) reasons.push("multi_season_holdout_required");
  if (games.some(g => !g.source.trim() || !Number.isFinite(Date.parse(g.playedAt)) ||
    !Number.isFinite(g.closingHomeSpread) || !Number.isFinite(g.closingHomePrice) ||
    !Number.isFinite(g.closingAwayPrice) || !Number.isInteger(g.homeScore) ||
    !Number.isInteger(g.awayScore) || g.homeScore < 0 || g.awayScore < 0 ||
    !validProbability(g.predictedHomeCoverProbability) ||
    !validProbability(g.predictedHomeWinProbability) ||
    !Number.isFinite(g.predictedHomeScore) || !Number.isFinite(g.predictedAwayScore)))
    reasons.push("unverified_or_incomplete_history");
  if (games.some(g => !g.injurySourceTimestamp || !Number.isFinite(Date.parse(g.injurySourceTimestamp))))
    reasons.push("missing_injury_provenance");
  if (!validProbability(opts.marketBaselineBrier ?? NaN))
    reasons.push("missing_independent_market_baseline");
  // Exact spread push is excluded from Brier scoring, never counted as a loss.
  const valid = games.filter(g => validProbability(g.predictedHomeCoverProbability) &&
    Number.isFinite(g.closingHomeSpread) && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore));
  const settled = valid.filter(g => g.homeScore - g.awayScore + g.closingHomeSpread !== 0);
  const brier = settled.length ? settled.reduce((sum, g) => {
    const hit = g.homeScore - g.awayScore + g.closingHomeSpread > 0 ? 1 : 0;
    return sum + (g.predictedHomeCoverProbability - hit) ** 2;
  }, 0) / settled.length : null;
  const mae = valid.length ? valid.reduce((sum, g) =>
    sum + Math.abs(g.predictedHomeScore - g.homeScore) + Math.abs(g.predictedAwayScore - g.awayScore), 0) / (2 * valid.length) : null;
  if (brier === null) reasons.push("no_settled_spread_games");
  else if (opts.marketBaselineBrier !== undefined && brier > opts.marketBaselineBrier)
    reasons.push("calibration_worse_than_market");
  return { eligible: reasons.length === 0, reasons, sampleSize: games.length,
    brierHomeCover: brier, scoreMeanAbsoluteError: mae };
}
