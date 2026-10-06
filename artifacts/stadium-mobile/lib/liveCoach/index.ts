/**
 * Live Coach Phase 1 + 2A/2B/3A (NBA/WNBA/NFL/NHL live mains).
 * Pregame Coach routing (buildParlay / isPregameBettable) stays untouched.
 */

export { wantsLiveCoachAsk } from "./wantsLiveCoachAsk.ts";
export {
  classifyLivePriceFreshness,
  LIVE_PRICE_STALE_AFTER_MS,
} from "./liveFreshness.ts";
export {
  normalizeLiveMarkets,
  normalizeMarketStatus,
  livePriceFromFeedRow,
  liveGameFromFeedRow,
} from "./liveMarketNormalize.ts";
export {
  detectLiveGameStateAdvance,
  materialClockAdvance,
  parseClockToSeconds,
} from "./liveGameStateAdvance.ts";
export {
  buildLiveBoardDiagnosticRows,
  formatLiveBoardDiagnosticsTable,
} from "./liveBoardDiagnostics.ts";

export { parseLiveCoachIntent } from "./liveCoachIntent.ts";
export {
  runRemainingGameSim,
  remainingMinutesFromState,
  elapsedMinutesFromState,
  hasUsableLiveClock,
  parseCountdownClockSeconds,
  parseEndOfPeriodLabel,
  isEndOfRegulationTransition,
  isExplicitOvertimeState,
  isExplicitShootoutState,
  isFinalState,
  isLiveCoachSport,
  createLiveSimRng,
  leagueBaselinePpg,
  regulationMinutes,
  periodLengthMinutes,
  regulationPeriodCount,
  overtimePeriodNumber,
  attachNhlSettlementToCoverQuery,
} from "./remainingGameSim.ts";
export { resolveNhlLiveMarketSettlement } from "./nhlMarketSettlement.ts";
export {
  evaluateLiveRecommendationEligibility,
  isLiveRecommendationEligible,
  isLivePhase2aMarket,
  isLivePhase2aSport,
  LIVE_PHASE2A_SPORTS,
  LIVE_PHASE2B_SPORTS,
  LIVE_PHASE3A_SPORTS,
  LIVE_COACH_SPORTS,
} from "./liveEligibility.ts";
export {
  gradeLiveMarket,
  liveCoverQueryFromMarket,
  liveConfidencePct,
  liveGradeLetter,
  LIVE_COACH_MIN_EDGE_PCT,
} from "./liveMarketGrade.ts";
export {
  buildLiveCoachRecommendations,
  liveRecommendationToPick,
} from "./buildLiveCoach.ts";

export type {
  LiveFreshnessStatus,
  LiveMarketStatus,
  LiveGameStateRecord,
  LivePriceRecord,
  NormalizedLiveMarket,
  LiveBoardDiagnosticRow,
} from "./types.ts";
export type { LiveCoachIntent } from "./liveCoachIntent.ts";
export type {
  RemainingGameSimInput,
  RemainingGameSimResult,
  LiveCoverQuery,
  LiveCoachSport,
  LiveBasketballSport,
} from "./remainingGameSim.ts";
export type { LiveMarketGrade } from "./liveMarketGrade.ts";
export type {
  LiveCoachBuildOpts,
  LiveCoachBuildResult,
  LiveCoachRecommendation,
} from "./buildLiveCoach.ts";
