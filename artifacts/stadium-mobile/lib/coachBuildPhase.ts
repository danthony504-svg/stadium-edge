/**
 * Coach build-phase UI handoff while a board scan is in flight.
 * Does not change staging, qualification, freeze, or composer unlock policy —
 * only which AnalysisProgress phase label is shown while cards are still empty,
 * and when stall escape / send finally must clear busy.
 */

/** Keep "board-scan" (not "stream"/"score") until pick cards actually land. */
export function coachPhaseWhileAwaitingTicketCards(opts: {
  displayedPickCount: number;
  stashPickCount: number;
}): "board-scan" | "stream" {
  if (opts.displayedPickCount > 0) return "stream";
  if (opts.stashPickCount > 0) return "board-scan";
  return "board-scan";
}

/**
 * After a stall attempt, clear busy only when cards still missing AND no
 * same-request board-scan attempt is still pending (including empty stash
 * before the first onPartial). Otherwise composer unlocks mid-scan and the
 * dead-end "finished without pick cards" copy fires for every N-leg ask.
 */
export function shouldClearBusyAfterFailedStallPaint(opts: {
  hadStashPicks: boolean;
  displayedPickCountAfter: number;
  /** Incomplete stash scan, or owned attempt before first partial. */
  incompleteScanInFlight?: boolean;
}): boolean {
  if (opts.displayedPickCountAfter > 0) return false;
  if (opts.incompleteScanInFlight) return false;
  return true;
}

/**
 * Empty-card stall must cover context fetch + full board-scan budget.
 * 9-leg budget is 150s — stall must stay above that.
 */
export function emptyCardBoardScanStallMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 200_000;
  if (requestedLegs >= 9) return 180_000;
  if (requestedLegs >= 6) return 150_000;
  if (requestedLegs >= 3) return 120_000;
  return 120_000;
}

/**
 * Keep Coach "finishing" after send()'s try path when a same-request board-scan
 * attempt is still pending — including the empty-stash window before the first
 * onPartial. Requiring hasScanStash alone let finally clear busy and fire the
 * empty-ticket dead-end for plain N-leg parlays and props-only alike.
 */
export function shouldKeepBusyForIncompleteBoardScan(opts: {
  isParlayBuild: boolean;
  legTarget: number;
  displayedPickCount: number;
  scanComplete: boolean | null | undefined;
  hasScanStash: boolean;
  ticketFrozen?: boolean;
  /** True while this send still owns a board-scan attempt (feeds/scan/late-join). */
  boardScanPending?: boolean;
}): boolean {
  if (!opts.isParlayBuild || opts.legTarget < 3) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.ticketFrozen) return false;
  if (opts.boardScanPending && opts.scanComplete !== true) return true;
  if (!opts.hasScanStash) return false;
  return opts.scanComplete !== true;
}

/**
 * Suppress the "finished without pick cards" dead-end while a board-scan
 * attempt is still pending or an incomplete stash exists.
 */
export function shouldSuppressEmptyTicketDeadEnd(opts: {
  boardScanPending: boolean;
  scanComplete: boolean | null | undefined;
  hasScanStash: boolean;
}): boolean {
  if (opts.boardScanPending && opts.scanComplete !== true) return true;
  if (opts.hasScanStash && opts.scanComplete !== true) return true;
  return false;
}
