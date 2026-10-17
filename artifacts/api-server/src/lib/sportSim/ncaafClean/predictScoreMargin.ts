/**
 * Stage A — score / margin generative core for ncaaf-score-margin-v1-research.
 */

import { NCAAF_CLEAN_ENGINE_STAMP } from "./stamp.ts";
import { availabilityStatus } from "./features.ts";
import type { AvailabilityInput } from "./types.ts";
import {
  CLEAN_HFA_POINTS,
  cleanMarginSd,
  cleanTotalSd,
  cleanUncertainty,
  type CleanOppAdjStrength,
} from "./strength.ts";
import { cleanMatchupSupport } from "./support.ts";
import type {
  CleanEnginePrediction,
  CleanGamePregame,
  MissingInput,
} from "./types.ts";

export type PredictScoreMarginOpts = {
  pregame: CleanGamePregame;
  strength: CleanOppAdjStrength;
  /** Optional pre-kick injury snapshot; historical TUNING usually absent. */
  availability?: AvailabilityInput | null;
};

/**
 * Predict score/margin means + σ. Causal: uses ratings as of call time only.
 * Venue unknown → HFA not applied; evaluableSupported=false (not silent neutral).
 * Injury missing → listed in missingOptional; no invented adjustment.
 * productionReleaseApproved is always false on this research stamp.
 */
export function predictScoreMargin(
  opts: PredictScoreMarginOpts,
): CleanEnginePrediction {
  const { pregame, strength } = opts;
  const stamp = NCAAF_CLEAN_ENGINE_STAMP;

  const support = cleanMatchupSupport({ pregame, strength });
  if (!support.supported) {
    return {
      stamp,
      eventId: pregame.eventId,
      ok: false,
      evaluableSupported: false,
      productionReleaseApproved: false,
      reason: support.reason,
    };
  }

  const av = availabilityStatus({
    kickoffIso: pregame.kickoffIso,
    availability: opts.availability,
  });
  const missingOptional: MissingInput[] = [...av.missing];

  const venueUnknown = pregame.venue.kind === "unknown";
  if (venueUnknown) {
    missingOptional.push("venue_unknown_material");
  }

  // HFA only when venue is explicitly home. Neutral → 0 with hfaApplied false
  // but still evaluable. Unknown → 0, NOT rewritten to neutral; not evaluable.
  let hfaPoints = 0;
  let hfaApplied = false;
  if (pregame.venue.kind === "home") {
    hfaPoints = CLEAN_HFA_POINTS;
    hfaApplied = true;
  } else if (pregame.venue.kind === "neutral") {
    hfaPoints = 0;
    hfaApplied = false;
  } else {
    hfaPoints = 0;
    hfaApplied = false;
  }

  const week = pregame.week ?? 99;
  const nHome = strength.getSeasonN(pregame.home.teamId);
  const nAway = strength.getSeasonN(pregame.away.teamId);
  const uncertainty = cleanUncertainty({
    week,
    nHomeFbsGames: nHome,
    nAwayFbsGames: nAway,
  });

  const pts = strength.expectedPoints(
    pregame.home.teamId,
    pregame.away.teamId,
    hfaPoints,
  );
  const marginSd = cleanMarginSd(uncertainty);
  const totalSd = cleanTotalSd(uncertainty);

  const featuresUsed = [
    "opp_adj_off_def",
    "uncertainty_n_week",
    pregame.venue.kind === "home"
      ? "venue_home_hfa"
      : pregame.venue.kind === "neutral"
        ? "venue_neutral_no_hfa"
        : "venue_unknown_hfa_withheld",
  ];
  if (pregame.rest.homeDaysRest != null || pregame.rest.awayDaysRest != null) {
    featuresUsed.push("rest_days");
  }
  if (av.usable) featuresUsed.push("availability_snapshot");

  // Venue unresolved → not evaluable for supported-input scoring (frozen).
  // Evaluable ≠ production-approved.
  const evaluableSupported = !venueUnknown;

  return {
    stamp,
    eventId: pregame.eventId,
    ok: true,
    evaluableSupported,
    productionReleaseApproved: false,
    homeScoreMean: pts.homeOff,
    awayScoreMean: pts.awayOff,
    marginMean: pts.marginMean,
    marginSd,
    totalMean: pts.totalMean,
    totalSd,
    hfaApplied,
    uncertainty,
    featuresUsed,
    missingOptional: [...new Set(missingOptional)],
  };
}
