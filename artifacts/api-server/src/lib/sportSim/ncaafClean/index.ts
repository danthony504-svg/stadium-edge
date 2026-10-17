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

export {
  NCAAF_GAME_LINE_SIM_VALIDATED,
  NCAAF_MARKET_READINESS,
  NCAAF_MARKET_SIM_VALIDATED,
  assertPerMarketGateIndependence,
  isNcaafMarketProductValidated,
  legacyMasterGateConsistent,
} from "./marketGates.ts";
export type {
  MarketGateSnapshot,
  MarketReadinessStatus,
  NcaafMarketFamily,
} from "./marketGates.ts";

export {
  ALT_CRITERIA,
  MARKET_GATE_POLICY,
  SPREAD_CRITERIA,
  TOTALS_CRITERIA,
  evaluateAltCriteria,
  evaluateSpreadCriteria,
  evaluateTotalsCriteria,
  marketProductUnlockLabel,
} from "./marketCriteria.ts";
export type {
  AltCriterionResult,
  AltMetricInputs,
  SpreadCriterionResult,
  SpreadMetricInputs,
  TotalsCriterionResult,
  TotalsMetricInputs,
} from "./marketCriteria.ts";

export {
  diagnoseNcaafMarkets,
  lockedCriteriaBundle,
} from "./marketDiagnosis.ts";
export type { MarketDiagnosisReport } from "./marketDiagnosis.ts";

export {
  E4_PROSPECTIVE_CRITERIA,
  mInjAdjustMeta,
  runE4ProspectiveEval,
} from "./e4ProspectiveEval.ts";
export type {
  E4ProspectiveReport,
  E4ProspectiveSampleCheck,
  ProspectiveGameRow,
} from "./e4ProspectiveEval.ts";

export { runAtsHarness } from "./atsHarness.ts";
export type {
  AtsCloseRow,
  AtsHarnessReport,
  AtsScoredGame,
} from "./atsHarness.ts";

export {
  ATS_REST_TILT_CANDIDATE_ID,
  ATS_REST_TILT_MAX_ABS_POINTS,
  ATS_REST_TILT_POINTS_PER_DAY,
  applyAtsRestTilt,
  computeAtsRestTilt,
} from "./atsRestTilt.ts";
export type { AtsRestTiltResult } from "./atsRestTilt.ts";

export {
  INJURY_COLLECTION_PERIOD,
  INJURY_COLLECTOR_ENV,
  INJURY_COLLECTOR_PATHS,
  INJURY_COLLECTOR_SCHEDULE,
  INJURY_SAMPLE_FLOORS,
  buildInjuryCollectorActivationPackage,
} from "./injuryCollectorActivation.ts";
export type { InjuryActivationPackage } from "./injuryCollectorActivation.ts";

export {
  appendFailure,
  contentSha256,
  defaultManifest,
  injuryMinuteBucket,
  loadManifest,
  persistInjurySnapshot,
  saveManifest,
} from "./injurySnapshotStore.ts";
export type {
  FailureRecord,
  InjurySnapshotPayload,
  PersistResult,
  SnapshotManifest,
  SnapshotManifestEntry,
} from "./injurySnapshotStore.ts";

export {
  SCORETAPE_DOCS_REST_SAMPLE,
  SCORETAPE_DOCS_WEBHOOK_SAMPLE,
  SCORETAPE_SETUP,
  buildScoreTapeProvenanceReport,
  verifyScoreTapeDocsSamples,
} from "./scoreTapeProvenance.ts";
export type { ScoreTapeProvenanceReport } from "./scoreTapeProvenance.ts";

export {
  SCORETAPE_EXPLORER_SETUP,
  SCORETAPE_SECURE_SETUP_STEPS,
  buildCfbCoverageBlockedReport,
  evaluateCfbInjuryRows,
  scoreTapeKeyConfigured,
  scoreTapeKeyPresence,
} from "./scoreTapeExplorerSetup.ts";
export type { CfbCoverageVerdict } from "./scoreTapeExplorerSetup.ts";

export {
  ODDS_PROVIDER,
  buildSpreadsTotalsAltManifest,
} from "./spreadsTotalsAltOddsManifest.ts";
export type {
  BucketRequest,
  ManifestGame,
  SpreadsTotalsAltManifestBundle,
} from "./spreadsTotalsAltOddsManifest.ts";

export { ODDS_RETRIEVAL_HOLD } from "./oddsEvalSplitHold.ts";
