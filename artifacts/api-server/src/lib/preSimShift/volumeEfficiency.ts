/**
 * Volume vs efficiency treatment for Venue / Opponent Matchup.
 *
 * Opportunity Shift (PR #699) remains the workload authority and is applied
 * once as opportunityShift. Venue/matchup signals are then kind-weighted:
 *
 *   volume markets:     only VOLUME_SIGNAL_WEIGHT of the log-distance from 1.0
 *   efficiency markets: full venue/matchup factors
 *
 * Formulas (family-level, applied once before the single 10k draw):
 *
 *   venueVolume     = exp(α · log(venueRaw))     α = VOLUME_SIGNAL_WEIGHT
 *   matchupVolume   = exp(α · log(matchupRaw))
 *   venueEff        = venueRaw
 *   matchupEff      = matchupRaw
 *
 *   volumeShift     = opportunity × venueVolume × matchupVolume
 *   efficiencyShift = opportunity × venueEff × matchupEff
 *
 *   attemptMean  = baseAttempts × volumeShift
 *   yardageMean  = baseYards × efficiencyShift
 *
 * Opportunity is never applied twice. Volume markets keep redistributed
 * carries/targets when defense is tough; yardage absorbs the efficiency hit.
 */

import { opportunityMarketFamily } from "../opportunityShift/marketFamily.js";

/** Fraction of venue/matchup log-signal retained on volume markets. */
export const VOLUME_SIGNAL_WEIGHT = 0.2;

export type ShiftKind = "volume" | "efficiency" | "neutral";

const VOLUME_FAMILIES = new Set([
  "rush_attempts",
  "pass_attempts",
  // Completions track attempt volume (attempts × completion rate), not YPA.
  "pass_completions",
  "targets",
  // Receptions are primarily target-volume driven for shift purposes.
  "receptions",
]);

const EFFICIENCY_FAMILIES = new Set([
  "rush_yds",
  "pass_yds",
  "rec_yds",
  "rush_longest",
  "rec_longest",
  "pass_longest",
  "pass_interceptions",
  "pass_tds",
  "points",
  "rebounds",
  "assists",
  "threes",
  "hits",
  "total_bases",
  "home_runs",
  "stolen_bases",
  "strikeouts",
  "shots",
  "shots_on_goal",
  "shots_on_target",
  "goals",
  "anytime_goal",
]);

export function marketShiftKind(
  market: string | null | undefined,
  sport?: string | null,
  family?: string | null,
): ShiftKind {
  const fam = family ?? opportunityMarketFamily(market, sport);
  if (!fam) return "neutral";
  if (VOLUME_FAMILIES.has(fam)) return "volume";
  if (EFFICIENCY_FAMILIES.has(fam)) return "efficiency";
  return "neutral";
}

/** Pull a multiplicative factor toward 1.0 by retaining only `weight` of log-distance. */
export function dampenFactorTowardOne(
  factor: number,
  weight: number = VOLUME_SIGNAL_WEIGHT,
): number {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return 1;
  const w = Math.max(0, Math.min(1, weight));
  if (w === 1) return factor;
  if (w === 0) return 1;
  return Math.exp(w * Math.log(factor));
}

export function kindWeightedVenueMatchup(
  venueRaw: number,
  matchupRaw: number,
  kind: ShiftKind,
): { venueShift: number; opponentMatchupShift: number } {
  if (kind === "volume") {
    return {
      venueShift: dampenFactorTowardOne(venueRaw),
      opponentMatchupShift: dampenFactorTowardOne(matchupRaw),
    };
  }
  // efficiency + neutral: full signal
  return {
    venueShift: venueRaw > 0 && Number.isFinite(venueRaw) ? venueRaw : 1,
    opponentMatchupShift:
      matchupRaw > 0 && Number.isFinite(matchupRaw) ? matchupRaw : 1,
  };
}
