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
 * Game-line-only stashes need longer before escape — prop waves start after
 * slate game sims. Escaping at 20s painted 5 AI game lines and never waited
 * for ~50% player props.
 */
export function underCountHeldBoardScanEscapeMsForStash(opts: {
  requestedLegs: number;
  stashPropCount: number;
}): number {
  const base = underCountHeldBoardScanEscapeMs(opts.requestedLegs);
  if (opts.stashPropCount > 0) return base;
  // Wait through first prop sim waves before force-showing a game-line ticket.
  if (opts.requestedLegs >= 9) return Math.max(base, 55_000);
  if (opts.requestedLegs >= 6) return Math.max(base, 45_000);
  return Math.max(base, 35_000);
}


/**
 * Hard wait for reserved 0-prop previews before UI may escape as an honest
 * shortfall. Sized above the scanner prop-phase deadline so scanComplete
 * normally wins; the UI deadline is the belt if the scanner never finalizes.
 */
export function awaitingPropSlotsMaxWaitMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 90_000;
  if (requestedLegs >= 9) return 75_000;
  if (requestedLegs >= 6) return 60_000;
  return 50_000;
}

/** Stall window for a reserved 0-prop preview (or normal under-count stash). */
export function underCountEscapeWindowMsForStash(opts: {
  requestedLegs: number;
  stashPropCount: number;
  awaitingPropSlots?: boolean;
  scanComplete?: boolean | null;
}): number {
  if (
    opts.awaitingPropSlots &&
    opts.stashPropCount <= 0 &&
    opts.scanComplete !== true
  ) {
    return awaitingPropSlotsMaxWaitMs(opts.requestedLegs);
  }
  return underCountHeldBoardScanEscapeMsForStash({
    requestedLegs: opts.requestedLegs,
    stashPropCount: opts.stashPropCount,
  });
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
  stashPropCount?: number;
  awaitingPropSlots?: boolean;
  scanComplete?: boolean | null;
}): number {
  if (opts.displayedPickCount > 0) return opts.deepStallMs;
  if (opts.stashPickCount > 0) {
    // Reserved 0-prop preview: wait the prop-slot budget, not the short escape.
    if (opts.awaitingPropSlots && (opts.stashPropCount ?? 0) <= 0) {
      return awaitingPropSlotsMaxWaitMs(opts.requestedLegs);
    }
    // Unknown prop count → keep the short escape (legacy). Explicit 0 props
    // waits longer for prop waves.
    if (opts.stashPropCount == null) {
      return underCountHeldBoardScanEscapeMs(opts.requestedLegs);
    }
    return underCountHeldBoardScanEscapeMsForStash({
      requestedLegs: opts.requestedLegs,
      stashPropCount: opts.stashPropCount,
    });
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
  /**
   * Reserved prop-slot preview waited past its hard deadline — stop keeping
   * busy forever; escape / dead-end must be allowed to unlock.
   */
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  if (!opts.isParlayBuild || opts.legTarget < 3) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.ticketFrozen) return false;
  // forceShow alone must NOT drop busy — escape can latch forceShow then fail to
  // paint, and clearing busy here left an empty bubble with dead-end suppressed.
  // Only stop keeping busy once cards are actually on screen (checked above).
  if (opts.awaitingPropSlotsPastDeadline) return false;
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
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.boardScanPending && opts.scanComplete !== true) return true;
  if (opts.hasScanStash && opts.scanComplete !== true) return true;
  return false;
}

/**
 * Stall / late-join escape: if the scan stash already has scored legs but the
 * bubble is still empty (fixed-leg hold), release under-count cards and clear
 * busy. Keeps mid-scan 2→5 drip blocked until this escape fires.
 *
 * Do NOT escape a preview that only looks short because prop slots were
 * reserved (awaitingPropSlots + 0 props). That published "3 of 6 game lines"
 * before prop sims started and never upgraded.
 */
export function shouldReleaseUnderCountBoardScanAtEscape(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  /** Preview truncated to leave room for props that have not scored yet. */
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
  /** Elapsed ms since the reserved preview first appeared (or since send). */
  awaitingPropSlotsWaitElapsedMs?: number;
  requestedLegs?: number;
}): boolean {
  if (opts.stashPickCount <= 0 || opts.displayedPickCount > 0) return false;
  if (
    opts.awaitingPropSlots &&
    (opts.stashPropCount ?? 0) <= 0 &&
    opts.scanComplete !== true
  ) {
    const maxWait = awaitingPropSlotsMaxWaitMs(opts.requestedLegs ?? 6);
    const elapsed = opts.awaitingPropSlotsWaitElapsedMs ?? 0;
    if (elapsed < maxWait) return false;
  }
  return true;
}

/**
 * Arm the under-count escape clock when the stash is a paint candidate.
 * Reserved 0-prop previews arm the longer awaitingPropSlots budget (not the
 * short under-count escape) so props get a real window — then escape fires.
 */
export function shouldArmUnderCountEscapeDeadline(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
}): boolean {
  if (opts.stashPickCount <= 0 || opts.displayedPickCount > 0) return false;
  // Reserved preview: still arm a deadline (the long prop-slot wait).
  if (
    opts.awaitingPropSlots &&
    (opts.stashPropCount ?? 0) <= 0 &&
    opts.scanComplete !== true
  ) {
    return true;
  }
  return shouldReleaseUnderCountBoardScanAtEscape(opts);
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

/**
 * Dead-end bubble copy. Only claim the board scan "may still be scoring" while
 * a same-request attempt is actually pending — otherwise that line is a lie and
 * trains users to wait on a finished empty build.
 */

/**
 * Stall unlock must treat a latched forceShow with an empty bubble as still
 * in-flight when a scan is pending or an incomplete stash remains — otherwise
 * escape latches forceShow, paint fails, and busy clears into a suppressed dead-end.
 */
export function stallIncompleteScanStillInFlight(opts: {
  forceShowIncomplete: boolean;
  boardScanPending: boolean;
  scanComplete: boolean | null | undefined;
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  if (opts.displayedPickCount > 0) return false;
  // Completed scans must unlock — dead-end / forceShow retry paint the shortfall
  // or show Try again. Treating complete+forceShow as in-flight left permanent 93%.
  if (opts.scanComplete === true) return false;
  // Past prop-slot deadline: do not claim still in-flight forever.
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.boardScanPending) return true;
  if (opts.stashPickCount > 0) return true;
  // forceShow alone with nothing left to paint is not in-flight.
  void opts.forceShowIncomplete;
  return false;
}

/**
 * Do not re-arm the +8s stall poke forever. Once the absolute budget is
 * exhausted (or prop-slot wait has passed), unlock / dead-end instead.
 */
export function shouldReArmBoardScanStallPoke(opts: {
  displayedPickCount: number;
  awaitingPropSlotsPastDeadline?: boolean;
  absoluteStallBudgetExhausted?: boolean;
}): boolean {
  if (opts.displayedPickCount > 0) return false;
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.absoluteStallBudgetExhausted) return false;
  return true;
}

/** Honest progress copy while reserved prop slots are still scoring. */
export function coachBoardScanProgressCopy(opts: {
  scoredLegCount: number;
  requestedLegs: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
}): string | null {
  if (opts.scoredLegCount <= 0) return null;
  if (
    opts.awaitingPropSlots &&
    (opts.stashPropCount ?? 0) <= 0 &&
    opts.requestedLegs > 0
  ) {
    return `Scoring player props for your ${opts.requestedLegs}-leg ticket…`;
  }
  if (opts.requestedLegs > 0) {
    return `Scored ${opts.scoredLegCount} of ${opts.requestedLegs} legs — finishing your ticket…`;
  }
  return `Scored ${opts.scoredLegCount} legs — finishing your ticket…`;
}

export function emptyTicketDeadEndMessage(opts: {
  boardScanPending: boolean;
  scanComplete?: boolean | null;
}): string {
  if (opts.boardScanPending && opts.scanComplete !== true) {
    return "This build finished without pick cards — the board scan may still be scoring. Tap below to try again.";
  }
  return "This build finished without pick cards. Tap below to try again.";
}

