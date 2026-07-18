import type { FullBoardScanResult } from "./boardMarketScanner.ts";

export type BoardScanRaceHandle = {
  /** Resolves when the scan finishes (success or failure). */
  promise: Promise<FullBoardScanResult | null>;
  /** Resolves at budget timeout with null even if the scan is still running. */
  awaitBudget: () => Promise<FullBoardScanResult | null>;
};

/** Race a board scan against a UI budget while keeping the scan alive in the background. */
export function startBoardScanRace(
  scanPromise: Promise<FullBoardScanResult | null>,
  budgetMs: number,
  onBackgroundSettled?: (result: FullBoardScanResult | null) => void,
): BoardScanRaceHandle {
  const promise = scanPromise
    .then((result) => {
      onBackgroundSettled?.(result);
      return result;
    })
    .catch(() => {
      onBackgroundSettled?.(null);
      return null;
    });

  const awaitBudget = () =>
    Promise.race([
      scanPromise.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
    ]);

  return { promise, awaitBudget };
}
