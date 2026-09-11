/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether incomplete restaged pick cards are shown in the chat bubble.
 *
 * Hold under-count waves (no 4→5 churn / "scan continues" flicker).
 * Release once the stash hits the requested count, scanComplete, or an
 * empty-card stall escape — never sit on 93% with "Scored N of N" and no cards.
 * Sticky blank protection only for a full shown ticket.
 */

/** Prefer the larger of gated progress vs raw stash — never `||` (4 || 6 === 4). */
export function boardScanDisplayReadyCount(
  gatedPickCount: number,
  stashPickCount: number,
): number {
  return Math.max(gatedPickCount || 0, stashPickCount || 0);
}

/** Fixed-leg live scans: hold pick cards until full count / complete / stall. */
export function shouldHoldIncompleteBoardScanPickDisplay(opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  /** Qualified / restaged pick count currently in the scan stash. */
  readyPickCount?: number;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
}): boolean {
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return false;
  if (opts.scanComplete === true) return false;
  if (opts.legTarget < 3) return false;
  // Full requested count: show the ticket (scan may still exhaust the board).
  if ((opts.readyPickCount ?? 0) >= opts.legTarget) return false;
  return true;
}

/**
 * Under-count restages may blank held cards (re-hold).
 * Only a full-count ticket already on screen is sticky — never freeze 4 of 6.
 */
export function shouldBlankHeldBoardScanPickDisplay(opts: {
  holdIncomplete: boolean;
  displayedPickCount: number;
  legTarget?: number;
}): boolean {
  if (!opts.holdIncomplete) return false;
  const target = opts.legTarget ?? 0;
  if (target >= 3 && opts.displayedPickCount >= target) return false;
  return true;
}
