export type CoachTimedOutBoardScan = {
  requestedLegs?: number;
  picks?: { length: number };
  scanComplete?: boolean;
};

export type CoachBoardScanTimeoutResolution<T extends CoachTimedOutBoardScan> =
  | { terminal: "completed"; scan: T }
  | { terminal: "failed"; scan: null };

/**
 * Decide the terminal outcome after the full-board promise reaches its deadline.
 * Ticket presentation waits for the completed board, including legitimate
 * shortfalls, so timeout must never surface a transient preview.
 */
export function resolveCoachBoardScanTimeout<T extends CoachTimedOutBoardScan>(
  raceResult: T | null | undefined,
  stagedResult: T | null | undefined,
  requestedLegs: number,
): CoachBoardScanTimeoutResolution<T> {
  for (const scan of [raceResult, stagedResult]) {
    if (!scan?.picks?.length) continue;
    if (requestedLegs > 0 && scan.requestedLegs !== requestedLegs) continue;
    if (scan.scanComplete === true) {
      return { terminal: "completed", scan };
    }
  }
  return { terminal: "failed", scan: null };
}
