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

export {
  E4_POLICY,
  classifyAvailabilitySnapshot,
  coerceInjuryKnownForbidden,
  e4ConservativeAdjust,
  evaluateE4SegmentConservatism,
  joinE4Labels,
} from "./e4Availability.ts";
export type {
  E4ConservativeAdjust,
  E4JoinLabels,
  E4SegmentRow,
  E4SnapshotClass,
} from "./e4Availability.ts";

export { predictScoreMargin } from "./predictScoreMargin.ts";
export type { PredictScoreMarginOpts } from "./predictScoreMargin.ts";

export {
  CLEAN_E1_ALPHA,
  CLEAN_E1_CANDIDATE_ID,
  predictE1Frozen,
} from "./e1Frozen.ts";
export type {
  E1FrozenPrediction,
  E1FrozenPredictFail,
  E1FrozenPredictOk,
} from "./e1Frozen.ts";

export {
  CLV_CRITERIA,
  evaluateClvCriteria,
  evaluateMlCriteria,
  finalMlAcceptanceLabel,
  ML_CRITERIA,
  ML_ONLY_POLICY,
} from "./mlOnlyCriteria.ts";
export type {
  ClvCriterionResult,
  ClvMetricInputs,
  MlCriterionResult,
  MlMetricInputs,
} from "./mlOnlyCriteria.ts";

export { runMlOnlyHarness } from "./mlOnlyHarness.ts";
export type {
  MlCloseRow,
  MlHarnessGame,
  MlHarnessOpts,
  MlHarnessReport,
} from "./mlOnlyHarness.ts";
