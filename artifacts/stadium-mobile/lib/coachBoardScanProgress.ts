// Live board-scan progress for Coach loading UI.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";

export type BoardScanLiveProgress = {
  gamesLoaded: number;
  propsAnalyzed: number;
  marketsScanned: number;
  simRunning: boolean;
  scanComplete: boolean;
  picksReady: number;
  /** True when the scan finished with zero deliverable legs — stop retry loops. */
  exhaustedEmpty?: boolean;
  /** Human-readable reason when exhaustedEmpty is true. */
  emptyReason?: string;
};

export function deriveBoardScanLiveProgress(
  partial: FullBoardScanResult,
  emptyReason?: string,
): BoardScanLiveProgress {
  const m = partial.manifest;
  const gamesLoaded = partial.evalLinesByGame?.size ?? m?.gameLinesSimulated ?? 0;
  const propsAnalyzed = m?.propsSimulated ?? m?.propsFound ?? 0;
  const marketsScanned = partial.totalScanned ?? m?.marketsSimulated ?? 0;
  const scanComplete = partial.scanComplete === true;
  const picksReady = partial.picks?.length ?? 0;
  const exhaustedEmpty = scanComplete && picksReady === 0;
  const simRunning =
    !scanComplete &&
    ((m?.propsSimBatches ?? 0) > 0 || (m?.propsEligibleForSim ?? 0) > propsAnalyzed);
  return {
    gamesLoaded,
    propsAnalyzed,
    marketsScanned,
    simRunning,
    scanComplete,
    picksReady,
    exhaustedEmpty,
    emptyReason: exhaustedEmpty ? emptyReason : undefined,
  };
}
