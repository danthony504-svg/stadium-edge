/**
 * Venue Shift — player/team home vs away split vs season baseline.
 *
 * Formula:
 *   venueRate   = mean(homeValues) if isHome else mean(awayValues)
 *   seasonRate  = mean(seasonValues)
 *   raw         = venueRate / seasonRate
 *   venueShift  = clamp( shrink(raw, n, n0=8) , 0.90, 1.12 )
 *
 * Sample < 3 → 1.0 (regress fully to season / no shift).
 * Unrelated families stay at 1.0 via caller gating on opportunityMarketFamily.
 */

import { opportunityMarketFamily, isFamilyShiftAllowed } from "../opportunityShift/marketFamily.js";
import { filterSeriesForMarket } from "./periodGuard.js";
import { cappedRatio, meanFinite, safeRatio } from "./shrink.js";
import { PRE_SIM_SHIFT_CAPS, type VenueShiftInput } from "./types.js";

export type VenueShiftResult = {
  factor: number;
  sample: number;
  explain: string | null;
  family: string | null;
};

export function computeVenueShift(input: VenueShiftInput): VenueShiftResult {
  const family = opportunityMarketFamily(input.market, input.sport);
  if (!isFamilyShiftAllowed(family, input.sport) || input.isHome == null) {
    return { factor: 1, sample: 0, explain: null, family };
  }

  const season = filterSeriesForMarket(input.market, input.seasonValues);
  const venueVals = filterSeriesForMarket(
    input.market,
    input.isHome ? input.homeValues : input.awayValues,
  );
  const seasonMean = meanFinite(season);
  const venueMean = meanFinite(venueVals);
  const raw = safeRatio(venueMean, seasonMean);
  if (raw == null) {
    return { factor: 1, sample: venueVals.length, explain: null, family };
  }

  const { factor, sample } = cappedRatio(
    raw,
    venueVals.length,
    PRE_SIM_SHIFT_CAPS.venueMin,
    PRE_SIM_SHIFT_CAPS.venueMax,
  );

  if (factor === 1) {
    return { factor: 1, sample, explain: null, family };
  }

  const side = input.isHome ? "home" : "away";
  return {
    factor,
    sample,
    family,
    explain: `Venue Shift: ${side} split n=${sample} raw=${raw.toFixed(3)} → ×${factor.toFixed(3)}`,
  };
}
