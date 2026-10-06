/**
 * Live Coach Phase 1 + Phase 2A (NBA/WNBA live mains).
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

// Phase 2A
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
  createLiveSimRng,
  leagueBaselinePpg,
  regulationMinutes,
} from "./remainingGameSim.ts";
export {
  evaluateLiveRecommendationEligibility,
  isLiveRecommendationEligible,
  isLivePhase2aMarket,
  isLivePhase2aSport,
  LIVE_PHASE2A_SPORTS,
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
  LiveBasketballSport,
} from "./remainingGameSim.ts";
export type { LiveMarketGrade } from "./liveMarketGrade.ts";
export type {
  LiveCoachBuildOpts,
  LiveCoachBuildResult,
  LiveCoachRecommendation,
} from "./buildLiveCoach.ts";
