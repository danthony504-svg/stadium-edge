// Live board-scan progress for Coach loading UI.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";

export type BoardScanLiveProgress = {
  gamesLoaded: number;
  propsAnalyzed: number;
  marketsScanned: number;
  simRunning: boolean;
  scanComplete: boolean;
  picksReady: number;
};

export function deriveBoardScanLiveProgress(
  partial: FullBoardScanResult,
): BoardScanLiveProgress {
  const m = partial.manifest;
  const gamesLoaded = partial.evalLinesByGame?.size ?? m?.gameLinesSimulated ?? 0;
  const propsAnalyzed = m?.propsSimulated ?? m?.propsFound ?? 0;
  const marketsScanned = partial.totalScanned ?? m?.marketsSimulated ?? 0;
  const simRunning =
    !partial.scanComplete &&
    ((m?.propsSimBatches ?? 0) > 0 || (m?.propsEligibleForSim ?? 0) > propsAnalyzed);
  return {
    gamesLoaded,
    propsAnalyzed,
    marketsScanned,
    simRunning,
    scanComplete: partial.scanComplete === true,
    picksReady: partial.picks?.length ?? 0,
  };
}
