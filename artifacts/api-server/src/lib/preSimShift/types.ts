/**
 * Pre-sim Venue Shift + Opponent Matchup Shift types.
 * Combines with Opportunity Shift (PR #697–#699) without modifying that engine.
 *
 * Pipeline (once, before the single 10k draw):
 *   opportunity → venue → opponent matchup → combined (log-space, capped)
 */

export const PRE_SIM_SHIFT_CAPS = {
  /** Per-factor venue band. */
  venueMin: 0.9,
  venueMax: 1.12,
  /** Per-factor opponent matchup band. */
  matchupMin: 0.9,
  matchupMax: 1.14,
  /** Combined family-level movement after opportunity × venue × matchup. */
  combinedMin: 0.78,
  combinedMax: 1.35,
  /** Bayesian prior games for shrinkage toward 1.0. */
  shrinkPriorGames: 8,
  /** Minimum sample to emit a non-1.0 venue/matchup factor. */
  minSample: 3,
  /** Max weight of teammate receiving matchup on QB pass yards. */
  qbReceivingCoupling: 0.35,
} as const;

export type PreSimShiftFactors = {
  opportunityShift: number;
  venueShift: number;
  opponentMatchupShift: number;
  combinedShift: number;
  family: string | null;
  opportunityExplain: string | null;
  venueExplain: string | null;
  matchupExplain: string | null;
  combinedExplain: string | null;
  /** When true, skip soft home/away blend in buildProjectionMean (already in venueShift). */
  suppressSoftVenueBlend: boolean;
  /** When true, skip soft vsOpponent blend (already in opponentMatchupShift). */
  suppressSoftVsOpponentBlend: boolean;
  venueSample: number;
  matchupSample: number;
};

export type VenueShiftInput = {
  sport: string;
  market: string;
  isHome: boolean | null | undefined;
  /** Season / recent full-game values (newest first). */
  seasonValues: readonly number[];
  homeValues: readonly number[];
  awayValues: readonly number[];
};

export type OpponentMatchupInput = {
  sport: string;
  market: string;
  /** Season / recent full-game values. */
  seasonValues: readonly number[];
  /** Player vs this opponent (career/recent vs franchise). */
  vsOpponentValues: readonly number[];
  /**
   * Optional team defense index vs league (1.0 = average).
   * e.g. opp pass yards allowed / league avg. Already normalized.
   */
  defenseIndex?: number | null;
  /**
   * Optional dampened teammate receiving matchup for QB pass coupling (around 1.0).
   */
  coupledReceivingMatchup?: number | null;
};

export type CombinePreSimInput = {
  opportunityShift: number;
  venueShift: number;
  opponentMatchupShift: number;
  family: string | null;
  opportunityExplain?: string | null;
  venueExplain?: string | null;
  matchupExplain?: string | null;
  venueSample?: number;
  matchupSample?: number;
  suppressSoftVenueBlend?: boolean;
  suppressSoftVsOpponentBlend?: boolean;
};
