/**
 * Research-only ATS rest differential tilt (free input E).
 *
 * Declared before scoring — not fitted to FINAL_EVAL.
 * Does not modify predictE1Frozen / M_base moneyline path.
 * Opt-in via applyAtsRestTilt; default off.
 */

/** Locked research constant — days of rest advantage → margin points. */
export const ATS_REST_TILT_POINTS_PER_DAY = 0.35 as const;
/** Clamp absolute tilt so rest cannot dominate talent gap. */
export const ATS_REST_TILT_MAX_ABS_POINTS = 1.5 as const;

export const ATS_REST_TILT_CANDIDATE_ID = "ats-rest-tilt-v0-research" as const;

export type AtsRestTiltResult = {
  candidateId: typeof ATS_REST_TILT_CANDIDATE_ID;
  marginTiltPoints: number;
  applied: boolean;
  features: string[];
  notes: string[];
};

/**
 * Home−away rest differential tilt for ATS research only.
 * Missing rest on either side → no tilt (fail closed).
 */
export function computeAtsRestTilt(opts: {
  homeDaysRest: number | null | undefined;
  awayDaysRest: number | null | undefined;
}): AtsRestTiltResult {
  const notes: string[] = [];
  if (
    opts.homeDaysRest == null ||
    opts.awayDaysRest == null ||
    !Number.isFinite(opts.homeDaysRest) ||
    !Number.isFinite(opts.awayDaysRest)
  ) {
    return {
      candidateId: ATS_REST_TILT_CANDIDATE_ID,
      marginTiltPoints: 0,
      applied: false,
      features: [],
      notes: ["ats_rest_missing_no_tilt"],
    };
  }
  const diff = opts.homeDaysRest - opts.awayDaysRest;
  let tilt = diff * ATS_REST_TILT_POINTS_PER_DAY;
  if (Math.abs(tilt) > ATS_REST_TILT_MAX_ABS_POINTS) {
    tilt =
      Math.sign(tilt) * ATS_REST_TILT_MAX_ABS_POINTS;
    notes.push("ats_rest_tilt_clamped");
  }
  if (tilt === 0) {
    return {
      candidateId: ATS_REST_TILT_CANDIDATE_ID,
      marginTiltPoints: 0,
      applied: false,
      features: [],
      notes: ["ats_rest_diff_zero"],
    };
  }
  return {
    candidateId: ATS_REST_TILT_CANDIDATE_ID,
    marginTiltPoints: tilt,
    applied: true,
    features: ["ats_rest_differential"],
    notes,
  };
}

/**
 * Apply research rest tilt to a margin mean. Leaves ML frozen path untouched
 * when callers keep using predictE1Frozen without this helper.
 */
export function applyAtsRestTilt(opts: {
  marginMean: number;
  homeDaysRest: number | null | undefined;
  awayDaysRest: number | null | undefined;
}): { marginMean: number; tilt: AtsRestTiltResult } {
  const tilt = computeAtsRestTilt(opts);
  return {
    marginMean: opts.marginMean + tilt.marginTiltPoints,
    tilt,
  };
}
