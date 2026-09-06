import { coachBoardScanMayTerminalize } from "./coachTerminalGate.ts";

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
 * A request-matched ticket may complete only after it reaches the requested
 * count, or when the board scan itself has completed and established a
 * legitimate shortfall.
 */
export function resolveCoachBoardScanTimeout<T extends CoachTimedOutBoardScan>(
  raceResult: T | null | undefined,
  stagedResult: T | null | undefined,
  requestedLegs: number,
): CoachBoardScanTimeoutResolution<T> {
  for (const scan of [raceResult, stagedResult]) {
    if (!scan?.picks?.length) continue;
    if (requestedLegs > 0 && scan.requestedLegs !== requestedLegs) continue;
    if (coachBoardScanMayTerminalize({
      requestedLegs,
      finalizedPickCount: scan.picks.length,
      scanComplete: scan.scanComplete,
    })) {
      return { terminal: "completed", scan };
    }
  }
  return { terminal: "failed", scan: null };
}
