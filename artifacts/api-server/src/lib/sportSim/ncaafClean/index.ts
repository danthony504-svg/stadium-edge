/**
 * Clean research-only NCAAF engine (ncaaf-score-margin-v1-research).
 * Isolated from NFL drive sim and live Coach. Opt-in only.
 */

export {
  NCAAF_CLEAN_ENGINE_STAMP,
  ncaafCleanEngineResearchEnabled,
} from "./stamp.ts";
export type { NcaafCleanEngineStamp } from "./stamp.ts";

export type * from "./types.ts";

export {
  buildSeasonTeamIdentity,
  identitiesFromFixtureRow,
  matchupScopeForIds,
} from "./identity.ts";

export {
  availabilityStatus,
  buildPregameFromFixtureRow,
  buildRestInfo,
  daysBetweenKickoffs,
  recoverVenue,
  resultFromFixtureRow,
} from "./features.ts";

export {
  loadVenueSidecar,
  resetVenueSidecarCache,
  venueInfoFromSidecarRow,
  venueSidecarIndex,
} from "./venueSidecar.ts";
export type { VenueSidecarDoc, VenueSidecarRow } from "./venueSidecar.ts";

export {
  CLEAN_BASE_MARGIN_SD,
  CLEAN_BASE_TOTAL_SD,
  CLEAN_HFA_POINTS,
  CLEAN_LEAGUE_AVG_PPG,
  CLEAN_LR,
  CleanOppAdjStrength,
  cleanMarginSd,
  cleanTotalSd,
  cleanUncertainty,
} from "./strength.ts";
export type { CleanStrengthGame } from "./strength.ts";

export {
  normalCdf,
  pHomeCoverFromMargin,
  pHomeMlFromMargin,
  pOverFromTotal,
  settleAtsHome,
  settleMoneyline,
  settleTotal,
} from "./settlement.ts";
export type {
  AtsSettlement,
  MlSettlement,
  TotalSettlement,
} from "./settlement.ts";

export { cleanMatchupSupport } from "./support.ts";
export type { CleanSupportDecision } from "./support.ts";

export { predictScoreMargin } from "./predictScoreMargin.ts";
export type { PredictScoreMarginOpts } from "./predictScoreMargin.ts";
