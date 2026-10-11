export {
  PRE_SIM_SHIFT_CAPS,
  type PreSimShiftFactors,
  type VenueShiftInput,
  type OpponentMatchupInput,
  type CombinePreSimInput,
} from "./types.js";

export { computeVenueShift, type VenueShiftResult } from "./venue.js";
export {
  computeOpponentMatchupShift,
  isReceivingFamilyForQbCoupling,
  type OpponentMatchupResult,
} from "./opponentMatchup.js";
export {
  combinePreSimShifts,
  combinedCapProof,
  identityPreSimFactors,
} from "./combine.js";
export {
  isPeriodMarket,
  isFullGameMarket,
  filterSeriesForMarket,
} from "./periodGuard.js";
export { shrinkRatioToOne, cappedRatio, meanFinite, safeRatio } from "./shrink.js";

import { opportunityMarketFamily } from "../opportunityShift/marketFamily.js";
import { combinePreSimShifts, identityPreSimFactors } from "./combine.js";
import {
  computeOpponentMatchupShift,
  isReceivingFamilyForQbCoupling,
} from "./opponentMatchup.js";
import type { PreSimShiftFactors } from "./types.js";
import { computeVenueShift } from "./venue.js";

export type BuildPreSimShiftOpts = {
  sport: string;
  market: string;
  isHome?: boolean | null;
  seasonValues: readonly number[];
  homeValues: readonly number[];
  awayValues: readonly number[];
  vsOpponentValues: readonly number[];
  /** Opportunity Shift family multiplier (default 1). */
  opportunityShift?: number;
  opportunityExplain?: string | null;
  opportunityFamily?: string | null;
  /** Optional opp defense / league index (~1). */
  defenseIndex?: number | null;
  /**
   * Optional mean of teammate receiving matchup factors for QB coupling.
   * Only applied to pass_yds / pass_attempts / pass_completions.
   */
  coupledReceivingMatchup?: number | null;
};

/**
 * Build the shared adjustment result used by HTTP simulate and Coach in-process.
 * Pure sync — no I/O.
 */
export function buildPreSimShiftFactors(
  opts: BuildPreSimShiftOpts,
): PreSimShiftFactors {
  const family =
    opts.opportunityFamily ?? opportunityMarketFamily(opts.market, opts.sport);

  const venue = computeVenueShift({
    sport: opts.sport,
    market: opts.market,
    isHome: opts.isHome,
    seasonValues: opts.seasonValues,
    homeValues: opts.homeValues,
    awayValues: opts.awayValues,
  });

  const matchup = computeOpponentMatchupShift({
    sport: opts.sport,
    market: opts.market,
    seasonValues: opts.seasonValues,
    vsOpponentValues: opts.vsOpponentValues,
    defenseIndex: opts.defenseIndex,
    coupledReceivingMatchup: opts.coupledReceivingMatchup,
  });

  const opp = opts.opportunityShift ?? 1;
  if (opp === 1 && venue.factor === 1 && matchup.factor === 1) {
    return identityPreSimFactors(family);
  }

  return combinePreSimShifts({
    opportunityShift: opp,
    venueShift: venue.factor,
    opponentMatchupShift: matchup.factor,
    family,
    opportunityExplain: opts.opportunityExplain ?? null,
    venueExplain: venue.explain,
    matchupExplain: matchup.explain,
    venueSample: venue.sample,
    matchupSample: matchup.sample,
    suppressSoftVenueBlend: venue.factor !== 1,
    suppressSoftVsOpponentBlend: matchup.usedVsOpponent,
  });
}

/**
 * Aggregate teammate receiving matchup factors for QB pass coupling.
 * Equal-weight geometric mean of factors ≠ 1; ignores empties.
 * Callers supply per-receiver matchup factors already computed (role-specific).
 */
export function aggregateReceivingMatchupForQb(
  receivingFactors: readonly number[],
): number | null {
  const usable = receivingFactors.filter(
    (f) => Number.isFinite(f) && f > 0 && Math.abs(f - 1) > 1e-6,
  );
  if (!usable.length) return null;
  const logMean =
    usable.reduce((s, f) => s + Math.log(f), 0) / usable.length;
  return Math.exp(logMean);
}
