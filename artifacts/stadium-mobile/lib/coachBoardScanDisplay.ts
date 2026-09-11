/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether incomplete restaged pick cards are shown in the chat bubble.
 */

/** Fixed-leg live scans restage every wave (legs add/remove). Hold cards until complete. */
export function shouldHoldIncompleteBoardScanPickDisplay(opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  /** Qualified / restaged pick count currently in the scan stash. */
  readyPickCount?: number;
  /** Slate seed / explicit preview flashes may still show incomplete picks. */
  allowIncompletePicks?: boolean;
  /**
   * Stall / progress-expired / late-budget fallback — show the best ticket we
   * already have rather than leaving an empty 81–93% progress card forever.
   */
  forceShowIncomplete?: boolean;
}): boolean {
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return false;
  if (opts.scanComplete === true) return false;
  if (opts.legTarget < 3) return false;
  // Once the stash reaches the requested count, show it even if the scanner is
  // still exhausting the board — avoids a full-count ticket trapped behind hold.
  if ((opts.readyPickCount ?? 0) >= opts.legTarget) return false;
  return true;
}
