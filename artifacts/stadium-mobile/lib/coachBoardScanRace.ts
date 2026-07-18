// Bounded board scan — abort on budget expiry so scanComplete can finalize.

import type { FullBoardScanResult } from "./boardMarketScanner.ts";

/** Grace period after abort for buildTopLegsFromFullBoardScan to emit scanComplete. */
export const BOARD_SCAN_ABORT_SETTLE_MS = 8_000;

/**
 * Await a board scan up to budgetMs. When the budget expires, call abort() so the
 * scanner exits prop sim and emits a final scanComplete result.
 */
export async function awaitBoardScanWithinBudget(
  scanPromise: Promise<FullBoardScanResult | null>,
  budgetMs: number,
  abort: () => void,
): Promise<FullBoardScanResult | null> {
  if (budgetMs <= 0) {
    abort();
    return Promise.race([
      scanPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BOARD_SCAN_ABORT_SETTLE_MS)),
    ]);
  }

  let budgetExpired = false;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const raced = await Promise.race([
    scanPromise,
    new Promise<"timeout">((resolve) => {
      budgetTimer = setTimeout(() => {
        budgetExpired = true;
        abort();
        resolve("timeout");
      }, budgetMs);
    }),
  ]);
  if (budgetTimer) clearTimeout(budgetTimer);

  if (raced !== "timeout" && raced != null) return raced;
  if (!budgetExpired) return null;

  return Promise.race([
    scanPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BOARD_SCAN_ABORT_SETTLE_MS)),
  ]);
}
