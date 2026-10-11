/**
 * Pre-sim Venue Shift + Opponent Matchup Shift types.
 * Combines with Opportunity Shift (PR #697–#699) without modifying that engine.
 *
 * Pipeline (once, before the single 10k draw):
 *   opportunity → venue → opponent matchup → kind-weighted combine (log-space, capped)
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
  /** Minimum sample to emit a non-1.0 venue/matchup factor from player splits. */
  minSample: 3,
  /**
   * Max weight of teammate receiving matchup on QB pass production
   * after usage-weighted aggregate: factor *= (1 + w*(coupled-1)).
   */
  qbReceivingCoupling: 0.35,
  /** Cap on the usage-weighted receiving aggregate before QB coupling weight. */
  qbCouplingAggregateMin: 0.92,
  qbCouplingAggregateMax: 1.08,
  /** Season vs recent blend for venue rate (season weight when both available). */
  venueSeasonWeight: 0.55,
  venueRecentWeight: 0.45,
} as const;

export type PreSimShiftFactors = {
  opportunityShift: number;
  venueShift: number;
  opponentMatchupShift: number;
  /** Kind-weighted combined mult applied to the projection mean. */
  combinedShift: number;
  /** Explicit volume path: opp × dampened venue × dampened matchup. */
  volumeShift: number;
  /** Explicit efficiency path: opp × full venue × full matchup. */
  efficiencyShift: number;
  shiftKind: "volume" | "efficiency" | "neutral";
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
  /** All-game / season baseline values (newest first). */
  seasonValues: readonly number[];
  /** Full-season (or all available) home game values. */
  homeValues: readonly number[];
  /** Full-season (or all available) away game values. */
  awayValues: readonly number[];
  /** Recent same-side venue values (recency component); optional. */
  recentVenueValues?: readonly number[];
  /** Optional period tags aligned with season/home/away series. */
  seasonTags?: readonly (string | null | undefined)[] | null;
  homeTags?: readonly (string | null | undefined)[] | null;
  awayTags?: readonly (string | null | undefined)[] | null;
  recentVenueTags?: readonly (string | null | undefined)[] | null;
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
  seasonTags?: readonly (string | null | undefined)[] | null;
  vsOpponentTags?: readonly (string | null | undefined)[] | null;
};

export type CombinePreSimInput = {
  opportunityShift: number;
  venueShift: number;
  opponentMatchupShift: number;
  /** Raw (pre kind-weight) venue/matchup for volumeShift/efficiencyShift explain. */
  venueRaw?: number;
  matchupRaw?: number;
  shiftKind?: "volume" | "efficiency" | "neutral";
  family: string | null;
  opportunityExplain?: string | null;
  venueExplain?: string | null;
  matchupExplain?: string | null;
  venueSample?: number;
  matchupSample?: number;
  suppressSoftVenueBlend?: boolean;
  suppressSoftVsOpponentBlend?: boolean;
};
