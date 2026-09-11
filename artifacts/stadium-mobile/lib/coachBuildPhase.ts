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
 *
 * Exception: an incomplete board-scan still in flight must keep busy so the
 * dead-end "finished without pick cards" effect cannot fire before delivery.
 */
export function shouldClearBusyAfterFailedStallPaint(opts: {
  hadStashPicks: boolean;
  displayedPickCountAfter: number;
  /** True when a same-request scan exists but has not exhaustively finished. */
  incompleteScanInFlight?: boolean;
}): boolean {
  if (opts.displayedPickCountAfter > 0) return false;
  if (opts.incompleteScanInFlight) return false;
  return true;
}

/**
 * Empty-card board-scan stall must cover context fetch + full board-scan budget
 * (120s for 6 legs). Unlocking at 90s was racing late/kernel scans and writing
 * "finished without pick cards" before cards could land.
 */
export function emptyCardBoardScanStallMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 200_000;
  if (requestedLegs >= 9) return 180_000;
  if (requestedLegs >= 6) return 150_000;
  if (requestedLegs >= 3) return 120_000;
  return 120_000;
}

/**
 * After send()'s try path ends, keep Coach "finishing" when a same-request board
 * scan is still incomplete and no cards are on screen — otherwise finally clears
 * busy and the empty-ticket dead-end copy fires mid-scan.
 */
export function shouldKeepBusyForIncompleteBoardScan(opts: {
  isParlayBuild: boolean;
  legTarget: number;
  displayedPickCount: number;
  scanComplete: boolean | null | undefined;
  hasScanStash: boolean;
  ticketFrozen?: boolean;
}): boolean {
  if (!opts.isParlayBuild || opts.legTarget < 3) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.ticketFrozen) return false;
  if (!opts.hasScanStash) return false;
  return opts.scanComplete !== true;
}
