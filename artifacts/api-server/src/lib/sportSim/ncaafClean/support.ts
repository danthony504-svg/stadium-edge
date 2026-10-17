/**
 * Research support / release-eligibility gates for clean engine.
 * Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */

import type { CleanGamePregame, MissingInput } from "./types.ts";
import type { CleanOppAdjStrength } from "./strength.ts";

export type CleanSupportDecision =
  | {
      supported: true;
      scope: "fbs_fbs";
      hardMissing: MissingInput[];
    }
  | {
      supported: false;
      reason: MissingInput;
    };

export function cleanMatchupSupport(opts: {
  pregame: CleanGamePregame;
  strength: CleanOppAdjStrength;
}): CleanSupportDecision {
  const { pregame, strength } = opts;
  if (!Number.isFinite(pregame.season)) {
    return { supported: false, reason: "missing_season" };
  }
  if (pregame.matchupScope === "fbs_fcs") {
    return { supported: false, reason: "fbs_fcs_unsupported_scope" };
  }
  if (pregame.matchupScope === "fcs_fcs") {
    return { supported: false, reason: "fcs_fcs_unsupported_scope" };
  }
  if (pregame.matchupScope === "involves_unknown") {
    return { supported: false, reason: "involves_unknown_subdivision" };
  }
  const homeRated = strength.hasRating(pregame.home.teamId);
  const awayRated = strength.hasRating(pregame.away.teamId);
  if (!homeRated || !awayRated) {
    return { supported: false, reason: "unrated_fbs_side" };
  }
  return { supported: true, scope: "fbs_fbs", hardMissing: [] };
}
