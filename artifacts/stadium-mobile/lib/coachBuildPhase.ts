/**
 * Coach build-phase UI handoff while a board scan is in flight.
 * Does not change staging, qualification, freeze, or composer unlock policy —
 * only which AnalysisProgress phase label is shown while cards are still empty,
 * and when stall escape must clear busy.
 */

/** Keep "board-scan" (not "stream"/"score") until pick cards actually land. */
export function coachPhaseWhileAwaitingTicketCards(opts: {
  displayedPickCount: number;
  stashPickCount: number;
}): "board-scan" | "stream" {
  if (opts.displayedPickCount > 0) return "stream";
  // Stash may already be scoring — stay on board-scan so UI does not sit on
  // "Building final AI grade…" @ 93% with an empty bubble.
  if (opts.stashPickCount > 0) return "board-scan";
  return "board-scan";
}

/**
 * After a stall attempt, clear busy whenever cards still did not land —
 * including empty stash (no onPartial yet). Otherwise composer stays locked
 * on "Scanning…" @ 93% forever.
 */
export function shouldClearBusyAfterFailedStallPaint(opts: {
  hadStashPicks: boolean;
  displayedPickCountAfter: number;
}): boolean {
  return opts.displayedPickCountAfter <= 0;
}

/**
 * Empty-card board-scan stall should not wait the full deep budget (240s for
 * 6+ legs) while stash is still empty — unlock/retry much sooner.
 */
export function emptyCardBoardScanStallMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 120_000;
  if (requestedLegs >= 6) return 90_000;
  if (requestedLegs >= 3) return 75_000;
  return 90_000;
}
