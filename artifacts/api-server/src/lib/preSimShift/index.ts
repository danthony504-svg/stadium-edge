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
export {
  marketShiftKind,
  dampenFactorTowardOne,
  kindWeightedVenueMatchup,
  VOLUME_SIGNAL_WEIGHT,
  type ShiftKind,
} from "./volumeEfficiency.js";

import { opportunityMarketFamily } from "../opportunityShift/marketFamily.js";
import { combinePreSimShifts, identityPreSimFactors } from "./combine.js";
import { computeOpponentMatchupShift } from "./opponentMatchup.js";
import { PRE_SIM_SHIFT_CAPS, type PreSimShiftFactors } from "./types.js";
import { computeVenueShift } from "./venue.js";
import { marketShiftKind } from "./volumeEfficiency.js";

export type BuildPreSimShiftOpts = {
  sport: string;
  market: string;
  isHome?: boolean | null;
  seasonValues: readonly number[];
  homeValues: readonly number[];
  awayValues: readonly number[];
  vsOpponentValues: readonly number[];
  recentVenueValues?: readonly number[];
  seasonTags?: readonly (string | null | undefined)[] | null;
  homeTags?: readonly (string | null | undefined)[] | null;
  awayTags?: readonly (string | null | undefined)[] | null;
  recentVenueTags?: readonly (string | null | undefined)[] | null;
  vsOpponentTags?: readonly (string | null | undefined)[] | null;
  /** Opportunity Shift family multiplier (default 1). */
  opportunityShift?: number;
  opportunityExplain?: string | null;
  opportunityFamily?: string | null;
  /** Optional opp defense / league index (~1). */
  defenseIndex?: number | null;
  /**
   * Usage-weighted teammate receiving matchup for QB pass coupling (~1).
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
  const kind = marketShiftKind(opts.market, opts.sport, family);

  const venue = computeVenueShift({
    sport: opts.sport,
    market: opts.market,
    isHome: opts.isHome,
    seasonValues: opts.seasonValues,
    homeValues: opts.homeValues,
    awayValues: opts.awayValues,
    recentVenueValues: opts.recentVenueValues,
    seasonTags: opts.seasonTags,
    homeTags: opts.homeTags,
    awayTags: opts.awayTags,
    recentVenueTags: opts.recentVenueTags,
  });

  const matchup = computeOpponentMatchupShift({
    sport: opts.sport,
    market: opts.market,
    seasonValues: opts.seasonValues,
    vsOpponentValues: opts.vsOpponentValues,
    defenseIndex: opts.defenseIndex,
    coupledReceivingMatchup: opts.coupledReceivingMatchup,
    seasonTags: opts.seasonTags,
    vsOpponentTags: opts.vsOpponentTags,
  });

  const opp = opts.opportunityShift ?? 1;
  if (opp === 1 && venue.factor === 1 && matchup.factor === 1) {
    return identityPreSimFactors(family);
  }

  return combinePreSimShifts({
    opportunityShift: opp,
    venueShift: venue.factor,
    opponentMatchupShift: matchup.factor,
    venueRaw: venue.factor,
    matchupRaw: matchup.factor,
    shiftKind: kind,
    family,
    opportunityExplain: opts.opportunityExplain ?? null,
    venueExplain: venue.explain,
    matchupExplain: matchup.explain,
    venueSample: venue.sample,
    matchupSample: matchup.sample,
    suppressSoftVenueBlend: venue.factor !== 1,
    suppressSoftVsOpponentBlend: matchup.usedVsOpponent || matchup.usedDefenseIndex,
  });
}

export type ReceivingCouplingInput = {
  factor: number;
  /** Preferred: expected / projected targets for this game. */
  expectedTargets?: number | null;
  /** Recent per-game targets (mean). */
  recentTargets?: number | null;
  /** Recent receiving-yard share proxy (mean yards). */
  receivingYards?: number | null;
};

/**
 * Usage-weighted geometric mean of teammate receiving matchup factors.
 *
 * Weight priority per receiver:
 *   1. expectedTargets
 *   2. recentTargets
 *   3. receivingYards
 *   4. equal weight when no usage signal exists on any receiver
 *
 * Aggregate is capped to [qbCouplingAggregateMin, qbCouplingAggregateMax]
 * before the separate QB coupling weight (0.35) is applied in matchup.
 */
export function aggregateReceivingMatchupForQb(
  items: readonly ReceivingCouplingInput[] | readonly number[],
): number | null {
  const normalized: ReceivingCouplingInput[] = items.map((item) =>
    typeof item === "number" ? { factor: item } : item,
  );
  const usable = normalized.filter(
    (i) => Number.isFinite(i.factor) && i.factor > 0 && Math.abs(i.factor - 1) > 1e-6,
  );
  if (!usable.length) return null;

  const weightOf = (i: ReceivingCouplingInput): number | null => {
    if (i.expectedTargets != null && i.expectedTargets > 0) return i.expectedTargets;
    if (i.recentTargets != null && i.recentTargets > 0) return i.recentTargets;
    if (i.receivingYards != null && i.receivingYards > 0) return i.receivingYards;
    return null;
  };

  const weights = usable.map(weightOf);
  const anyUsage = weights.some((w) => w != null && w > 0);
  let logMean: number;
  if (anyUsage) {
    const effective = weights.map((w) => (w != null && w > 0 ? w : 0));
    // Receivers with no usage get epsilon so they don't vanish entirely, but
    // stay far below primary options.
    const floored = effective.map((w) => (w > 0 ? w : 1e-3));
    const sum = floored.reduce((a, b) => a + b, 0);
    logMean = usable.reduce(
      (s, item, idx) => s + Math.log(item.factor) * (floored[idx]! / sum),
      0,
    );
  } else {
    logMean = usable.reduce((s, item) => s + Math.log(item.factor), 0) / usable.length;
  }

  const geo = Math.exp(logMean);
  return Math.max(
    PRE_SIM_SHIFT_CAPS.qbCouplingAggregateMin,
    Math.min(PRE_SIM_SHIFT_CAPS.qbCouplingAggregateMax, geo),
  );
}
