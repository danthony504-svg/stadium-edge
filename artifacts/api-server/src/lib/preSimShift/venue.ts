/**
 * Venue Shift — player/team home vs away split vs season baseline.
 *
 * Formula (full-season venue when available + recent recency component):
 *
 *   venueSeason = mean(all homeValues) if isHome else mean(all awayValues)
 *   venueRecent = mean(recentVenueValues) when nRecent ≥ 1, else venueSeason
 *   venueRate   = 0.55·venueSeason + 0.45·venueRecent   when nRecent ≥ 3
 *               = venueSeason                              otherwise
 *   seasonRate  = mean(seasonValues)
 *   raw         = venueRate / seasonRate
 *   venueShift  = clamp( shrink(raw, nSeason, n0=8) , 0.90, 1.12 )
 *
 * Sample nSeason < 3 → 1.0.
 * Period-tagged values are dropped for full-game markets.
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

  const season = filterSeriesForMarket(
    input.market,
    input.seasonValues,
    input.seasonTags,
  );
  const venueVals = filterSeriesForMarket(
    input.market,
    input.isHome ? input.homeValues : input.awayValues,
    input.isHome ? input.homeTags : input.awayTags,
  );
  const recentVenue = filterSeriesForMarket(
    input.market,
    input.recentVenueValues ?? [],
    input.recentVenueTags,
  );

  const seasonMean = meanFinite(season);
  const venueSeasonMean = meanFinite(venueVals);
  if (seasonMean == null || venueSeasonMean == null) {
    return { factor: 1, sample: venueVals.length, explain: null, family };
  }

  let venueRate = venueSeasonMean;
  if (recentVenue.length >= 3) {
    const recentMean = meanFinite(recentVenue);
    if (recentMean != null) {
      venueRate =
        PRE_SIM_SHIFT_CAPS.venueSeasonWeight * venueSeasonMean +
        PRE_SIM_SHIFT_CAPS.venueRecentWeight * recentMean;
    }
  }

  const raw = safeRatio(venueRate, seasonMean);
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
