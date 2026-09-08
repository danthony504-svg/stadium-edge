// Guards correlation-timeout finalization — never commit before board scan settles.

import { boardScanIsComplete } from "./coachScanPolicy.ts";

export type CoachCorrelationTimeoutFinalizeInput = {
  scan: { scanComplete?: boolean } | null | undefined;
  boardScanInFlight: boolean;
  pendingScanCompletions: number;
};

/** True only when the live board scan finished and no scan promise is still settling. */
export function coachCorrelationTimeoutMayFinalize(
  input: CoachCorrelationTimeoutFinalizeInput,
): boolean {
  if (input.boardScanInFlight || input.pendingScanCompletions > 0) return false;
  return boardScanIsComplete(input.scan);
}
