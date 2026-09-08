export type CoachTimedOutBoardScan = {
  requestedLegs?: number;
  picks?: { length: number };
};

export type CoachBoardScanTimeoutResolution<T extends CoachTimedOutBoardScan> =
  | { terminal: "completed"; scan: T }
  | { terminal: "failed"; scan: null };

/**
 * Decide the terminal outcome after the full-board promise reaches its deadline.
 * A request-matched staged ticket is usable even if the final scan promise has
 * not settled yet; it contains only legs already qualified by the normal scan.
 */
export function resolveCoachBoardScanTimeout<T extends CoachTimedOutBoardScan>(
  raceResult: T | null | undefined,
  stagedResult: T | null | undefined,
  requestedLegs: number,
): CoachBoardScanTimeoutResolution<T> {
  for (const scan of [raceResult, stagedResult]) {
    if (!scan?.picks?.length) continue;
    if (requestedLegs > 0 && scan.requestedLegs !== requestedLegs) continue;
    return { terminal: "completed", scan };
  }
  return { terminal: "failed", scan: null };
}
