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
 * When the stash already has scored legs but fixed-leg hold still hides cards,
 * escape far sooner than the deep 240s stall. AnalysisProgress reaches ~93% /
 * "Final ticket ready" in a few seconds — waiting minutes with a scored stash
 * is the permanent-93% hang.
 */
export function underCountHeldBoardScanEscapeMs(requestedLegs: number): number {
  if (requestedLegs >= 9) return 25_000;
  if (requestedLegs >= 6) return 20_000;
  if (requestedLegs >= 3) return 15_000;
  return 15_000;
}

/**
 * Pick stall timeout from paint state:
 * - cards visible → deep budget
 * - stash scored, bubble empty → short under-count escape
 * - empty stash → empty-card budget (covers full board scan)
 */
export function boardScanStallMsForPaintState(opts: {
  displayedPickCount: number;
  stashPickCount: number;
  requestedLegs: number;
  deepStallMs: number;
}): number {
  if (opts.displayedPickCount > 0) return opts.deepStallMs;
  if (opts.stashPickCount > 0) {
    return underCountHeldBoardScanEscapeMs(opts.requestedLegs);
  }
  return emptyCardBoardScanStallMs(opts.requestedLegs);
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
  /** Stall/join escape already released under-count cards — do not re-arm busy. */
  forceShowIncomplete?: boolean;
}): boolean {
  if (!opts.isParlayBuild || opts.legTarget < 3) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.ticketFrozen) return false;
  // Escape latch: cards may still be painting; never re-lock at 93%.
  if (opts.forceShowIncomplete) return false;
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

/**
 * Stall / late-join escape: if the scan stash already has scored legs but the
 * bubble is still empty (fixed-leg hold), release under-count cards and clear
 * busy. Keeps mid-scan 2→5 drip blocked until this escape fires.
 */
export function shouldReleaseUnderCountBoardScanAtEscape(opts: {
  stashPickCount: number;
  displayedPickCount: number;
}): boolean {
  return opts.stashPickCount > 0 && opts.displayedPickCount <= 0;
}

/**
 * After late joins hit zero, always end the owned board-scan attempt — even if
 * the stash is still incomplete. Otherwise keep-busy + fixed-leg hold leave
 * Coach permanently at 93% with no cards.
 */
export function shouldEndBoardScanAttemptAfterLateJoins(opts: {
  lateJoinsRemaining: number;
}): boolean {
  return opts.lateJoinsRemaining <= 0;
}
