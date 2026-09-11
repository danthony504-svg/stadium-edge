/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether incomplete restaged pick cards are shown in the chat bubble.
 *
 * Hold was tried to stop mid-scan add/remove flicker, but it stranded users on
 * a slow empty 60–93% progress card. Incomplete picks show again; late
 * scanComplete still replaces the ticket via budget handoff.
 */

/** @deprecated Always false — incomplete board-scan picks are shown. */
export function shouldHoldIncompleteBoardScanPickDisplay(_opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  readyPickCount?: number;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
}): boolean {
  return false;
}
