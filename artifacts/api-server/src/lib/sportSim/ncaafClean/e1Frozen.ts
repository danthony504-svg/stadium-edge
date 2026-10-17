/**
 * Frozen clean E1 research candidate — α=1.15.
 * Margin-scale sweeps stopped. HFA after gap scale; σ formula unchanged.
 */

import { NCAAF_CLEAN_ENGINE_STAMP } from "./stamp.ts";
import {
  CLEAN_HFA_POINTS,
  cleanMarginSd,
  cleanUncertainty,
  type CleanOppAdjStrength,
} from "./strength.ts";
import { predictScoreMargin } from "./predictScoreMargin.ts";
import type { CleanEnginePrediction, CleanGamePregame } from "./types.ts";

/** Frozen E1 prior talent-gap scale — do not retune. */
export const CLEAN_E1_ALPHA = 1.15 as const;

export const CLEAN_E1_CANDIDATE_ID = "E1_alpha_1_15" as const;

export type E1FrozenPredictOk = {
  ok: true;
  stamp: typeof NCAAF_CLEAN_ENGINE_STAMP;
  candidateId: typeof CLEAN_E1_CANDIDATE_ID;
  alpha: typeof CLEAN_E1_ALPHA;
  evaluableSupported: boolean;
  productionReleaseApproved: false;
  marginMean: number;
  marginSd: number;
  uncertainty: number;
  homeScoreMean: number;
  awayScoreMean: number;
  totalMean: number;
  hfaApplied: boolean;
  featuresUsed: string[];
  missingOptional: string[];
};

export type E1FrozenPredictFail = {
  ok: false;
  stamp: typeof NCAAF_CLEAN_ENGINE_STAMP;
  candidateId: typeof CLEAN_E1_CANDIDATE_ID;
  alpha: typeof CLEAN_E1_ALPHA;
  evaluableSupported: false;
  productionReleaseApproved: false;
  reason: string;
};

export type E1FrozenPrediction = E1FrozenPredictOk | E1FrozenPredictFail;

/**
 * Predict with frozen E1 α=1.15 (M_base — no injury adjust).
 * ratingGap (HFA=0) scaled by α, then HFA added; uncertainty/σ unchanged from A0 path.
 * Availability / injury snapshots are intentionally not accepted — M_inj is a
 * separate prospective path and must not mutate this frozen candidate.
 */
export function predictE1Frozen(opts: {
  pregame: CleanGamePregame;
  strength: CleanOppAdjStrength;
  /** @deprecated Rejected — frozen ML never applies injury. */
  availability?: never;
}): E1FrozenPrediction {
  const { pregame, strength } = opts;
  // Never forward availability into the base path for M_base.
  const base = predictScoreMargin({ pregame, strength, availability: null });
  if (!base.ok) {
    return {
      ok: false,
      stamp: NCAAF_CLEAN_ENGINE_STAMP,
      candidateId: CLEAN_E1_CANDIDATE_ID,
      alpha: CLEAN_E1_ALPHA,
      evaluableSupported: false,
      productionReleaseApproved: false,
      reason: base.reason,
    };
  }

  const hfaPoints = pregame.venue.kind === "home" ? CLEAN_HFA_POINTS : 0;
  const hfaApplied = pregame.venue.kind === "home";
  const pts0 = strength.expectedPoints(
    pregame.home.teamId,
    pregame.away.teamId,
    0,
  );
  const marginMean = CLEAN_E1_ALPHA * pts0.marginMean + hfaPoints;
  const totalMean = pts0.totalMean;
  const homeScoreMean = (totalMean + marginMean) / 2;
  const awayScoreMean = (totalMean - marginMean) / 2;
  const uncertainty = cleanUncertainty({
    week: pregame.week ?? 99,
    nHomeFbsGames: strength.getSeasonN(pregame.home.teamId),
    nAwayFbsGames: strength.getSeasonN(pregame.away.teamId),
  });
  const marginSd = cleanMarginSd(uncertainty);

  return {
    ok: true,
    stamp: NCAAF_CLEAN_ENGINE_STAMP,
    candidateId: CLEAN_E1_CANDIDATE_ID,
    alpha: CLEAN_E1_ALPHA,
    evaluableSupported: base.evaluableSupported,
    productionReleaseApproved: false,
    marginMean,
    marginSd,
    uncertainty,
    homeScoreMean,
    awayScoreMean,
    totalMean,
    hfaApplied,
    featuresUsed: [...base.featuresUsed, "e1_gap_scale_1_15"],
    missingOptional: base.missingOptional,
  };
}

/** Re-export base type for callers that need raw A0 path comparison. */
export type { CleanEnginePrediction };
