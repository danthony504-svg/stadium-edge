/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether incomplete restaged pick cards are shown in the chat bubble.
 *
 * Mid-scan waves restage (2→4→3…). Hold cards while under the requested count.
 * Once a ticket has been shown, never blank it for a later under-count restage.
 */

/** Fixed-leg live scans: hold pick cards until full count / complete / stall. */
export function shouldHoldIncompleteBoardScanPickDisplay(opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  /** Qualified / restaged pick count currently in the scan stash. */
  readyPickCount?: number;
  /** Slate seed / explicit preview flashes may still show incomplete picks. */
  allowIncompletePicks?: boolean;
  /**
   * Stall / progress-expired fallback — show the best ticket we already have
   * rather than leaving an empty progress card forever.
   */
  forceShowIncomplete?: boolean;
}): boolean {
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return false;
  if (opts.scanComplete === true) return false;
  if (opts.legTarget < 3) return false;
  // Full requested count: show once (even if scanner is still exhausting).
  if ((opts.readyPickCount ?? 0) >= opts.legTarget) return false;
  return true;
}

/**
 * Under-count restages must not erase an already-visible ticket (6 legs → gone).
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
