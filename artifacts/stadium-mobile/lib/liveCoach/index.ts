/**
 * Live Coach Phase 1 — board hygiene only.
 * No live tickets, remaining-game sims, or pregame routing changes.
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
export type {
  LiveFreshnessStatus,
  LiveMarketStatus,
  LiveGameStateRecord,
  LivePriceRecord,
  NormalizedLiveMarket,
  LiveBoardDiagnosticRow,
} from "./types.ts";
