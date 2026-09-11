/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether incomplete restaged pick cards are shown in the chat bubble.
 *
 * Hold cards until scanComplete (or stall / preview). Releasing on "full count"
 * early let all-MLB waves lock in before NFL/NCAAF finished scoring.
 */

/** Fixed-leg live scans: hold pick cards until the board scan completes. */
export function shouldHoldIncompleteBoardScanPickDisplay(opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  readyPickCount?: number;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
}): boolean {
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return false;
  if (opts.scanComplete === true) return false;
  if (opts.legTarget < 3) return false;
  return true;
}

/**
 * Under-count / incomplete restages must not erase an already-visible ticket.
 * Keep the on-screen cards; only stash/progress updates until scanComplete.
 */
export function shouldBlankHeldBoardScanPickDisplay(opts: {
  holdIncomplete: boolean;
  displayedPickCount: number;
}): boolean {
  if (!opts.holdIncomplete) return false;
  if (opts.displayedPickCount > 0) return false;
  return true;
}
