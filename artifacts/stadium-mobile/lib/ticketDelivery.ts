/**
 * TicketDelivery — single authority for Coach board-scan → paint → busy → terminal.
 *
 * Scoring / qualification / sim grading stay in boardMarketScanner.
 * This module owns only the handoff contract:
 *
 *   Terminal ∈ { shown-mixed, shown-shortfall, empty-complete, failed-retry }
 *   Never leave awaitingPropSlots as the last stash state.
 *   Never clear busy with 0 cards while a scan is still owned (before deadline).
 *   Never re-arm stall forever past the prop-slot / absolute budget.
 *
 * Call sites MUST pass prop-slot wait elapsed from TicketDeliveryClock — omitting
 * it is what left Coach at 84% / "Scoring player props" forever.
 */

export type TicketDeliveryPhase =
  | "idle"
  | "scanning"
  | "stashed-held"
  | "awaiting-props"
  | "painting"
  | "shown-mixed"
  | "shown-shortfall"
  | "empty-complete"
  | "failed-retry";

/** Wall clocks owned by one send — reset on every new ask. */
export type TicketDeliveryClock = {
  sendStartedAtMs: number | null;
  awaitingPropSlotsStartedAtMs: number | null;
  underCountEscapeDeadlineAtMs: number | null;
};

export function createTicketDeliveryClock(now = Date.now()): TicketDeliveryClock {
  return {
    sendStartedAtMs: now,
    awaitingPropSlotsStartedAtMs: null,
    underCountEscapeDeadlineAtMs: null,
  };
}

export function resetTicketDeliveryClock(
  clock: TicketDeliveryClock,
  now = Date.now(),
): TicketDeliveryClock {
  clock.sendStartedAtMs = now;
  clock.awaitingPropSlotsStartedAtMs = null;
  clock.underCountEscapeDeadlineAtMs = null;
  return clock;
}

export function ticketPropSlotTarget(requestedLegs: number): number {
  if (requestedLegs < 3) return 0;
  return Math.max(1, Math.round(requestedLegs * 0.5));
}

/**
 * UI hard-stop for reserved 0-prop previews. Kept BELOW the scanner prop-phase
 * deadline so Coach paints an honest shortfall instead of sitting at 84% while
 * prop MC hangs. Background scan may still upgrade props after paint.
 */
export function ticketAwaitingPropSlotsMaxWaitMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 45_000;
  if (requestedLegs >= 9) return 35_000;
  if (requestedLegs >= 6) return 25_000;
  return 20_000;
}

export function ticketUnderCountEscapeMs(requestedLegs: number): number {
  if (requestedLegs >= 9) return 25_000;
  if (requestedLegs >= 6) return 20_000;
  if (requestedLegs >= 3) return 15_000;
  return 15_000;
}

export function ticketGameLineOnlyEscapeMs(requestedLegs: number): number {
  const base = ticketUnderCountEscapeMs(requestedLegs);
  if (requestedLegs >= 9) return Math.max(base, 55_000);
  if (requestedLegs >= 6) return Math.max(base, 45_000);
  return Math.max(base, 35_000);
}

export function ticketEmptyCardStallMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 200_000;
  if (requestedLegs >= 9) return 180_000;
  if (requestedLegs >= 6) return 150_000;
  if (requestedLegs >= 3) return 120_000;
  return 120_000;
}

export function ticketEscapeWindowMs(opts: {
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
    return ticketAwaitingPropSlotsMaxWaitMs(opts.requestedLegs);
  }
  if (opts.stashPropCount > 0) return ticketUnderCountEscapeMs(opts.requestedLegs);
  return ticketGameLineOnlyEscapeMs(opts.requestedLegs);
}

export function ticketAwaitingPropSlotsElapsedMs(
  clock: TicketDeliveryClock,
  now = Date.now(),
): number {
  if (clock.awaitingPropSlotsStartedAtMs == null) return 0;
  return Math.max(0, now - clock.awaitingPropSlotsStartedAtMs);
}

export function ticketAwaitingPropSlotsPastDeadline(opts: {
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
  requestedLegs: number;
  waitElapsedMs: number;
}): boolean {
  if (opts.scanComplete === true) return false;
  if (!opts.awaitingPropSlots || (opts.stashPropCount ?? 0) > 0) return false;
  return opts.waitElapsedMs >= ticketAwaitingPropSlotsMaxWaitMs(opts.requestedLegs);
}

/**
 * Hard terminal for reserved 0-prop previews: after the UI wait, always leave
 * awaiting-props limbo — paint the honest shortfall (or unlock) even if prop MC
 * never returns and stall re-arms keep resetting soft timers.
 */
export function ticketShouldForcePropSlotHardTerminal(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
  waitElapsedMs: number;
  requestedLegs: number;
}): boolean {
  if (opts.displayedPickCount > 0) return false;
  if (opts.stashPickCount <= 0) return false;
  if (opts.scanComplete === true) return true;
  return ticketAwaitingPropSlotsPastDeadline({
    awaitingPropSlots: opts.awaitingPropSlots,
    stashPropCount: opts.stashPropCount,
    scanComplete: opts.scanComplete,
    requestedLegs: opts.requestedLegs,
    waitElapsedMs: opts.waitElapsedMs,
  });
}

/** True when a reserved preview should arm the one-shot hard-terminal timer. */
export function ticketShouldArmPropSlotHardTerminal(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
}): boolean {
  if (opts.displayedPickCount > 0) return false;
  if (opts.stashPickCount <= 0) return false;
  if (opts.scanComplete === true) return false;
  return opts.awaitingPropSlots === true && (opts.stashPropCount ?? 0) <= 0;
}

export function ticketNoteAwaitingPropSlots(opts: {
  clock: TicketDeliveryClock;
  awaitingPropSlots?: boolean;
  stashPropCount: number;
  now?: number;
}): void {
  const awaiting =
    opts.awaitingPropSlots === true && opts.stashPropCount <= 0;
  if (awaiting && opts.clock.awaitingPropSlotsStartedAtMs == null) {
    opts.clock.awaitingPropSlotsStartedAtMs = opts.now ?? Date.now();
  }
  if (!awaiting) {
    opts.clock.awaitingPropSlotsStartedAtMs = null;
  }
}

/**
 * Escape / force-show decision. ALWAYS pass waitElapsedMs from the clock —
 * omitting it treats elapsed as 0 and blocks reserved previews forever.
 */
export function ticketShouldEscapeUnderCount(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
  waitElapsedMs: number;
  requestedLegs: number;
}): boolean {
  if (opts.stashPickCount <= 0 || opts.displayedPickCount > 0) return false;
  if (opts.scanComplete === true) return true;
  if (opts.awaitingPropSlots && (opts.stashPropCount ?? 0) <= 0) {
    return (
      opts.waitElapsedMs >=
      ticketAwaitingPropSlotsMaxWaitMs(opts.requestedLegs)
    );
  }
  return true;
}

export function ticketShouldArmEscapeDeadline(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
}): boolean {
  if (opts.stashPickCount <= 0 || opts.displayedPickCount > 0) return false;
  return true;
}

export function ticketShouldKeepBusy(opts: {
  isParlayBuild: boolean;
  legTarget: number;
  displayedPickCount: number;
  scanComplete?: boolean | null;
  hasScanStash: boolean;
  ticketFrozen?: boolean;
  boardScanPending?: boolean;
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  if (!opts.isParlayBuild || opts.legTarget < 3) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.ticketFrozen) return false;
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.scanComplete === true) return false;
  if (opts.boardScanPending) return true;
  if (!opts.hasScanStash) return false;
  return true;
}

export function ticketShouldSuppressEmptyDeadEnd(opts: {
  boardScanPending: boolean;
  scanComplete?: boolean | null;
  hasScanStash: boolean;
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.scanComplete === true) return false;
  if (opts.boardScanPending) return true;
  if (opts.hasScanStash) return true;
  return false;
}

export function ticketShouldReArmStallPoke(opts: {
  displayedPickCount: number;
  awaitingPropSlotsPastDeadline?: boolean;
  absoluteStallBudgetExhausted?: boolean;
}): boolean {
  if (opts.displayedPickCount > 0) return false;
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.absoluteStallBudgetExhausted) return false;
  return true;
}

export function ticketProgressCopy(opts: {
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

/**
 * Before force-showing a reserved preview past the deadline (or after
 * scanComplete), clear awaitingPropSlots so display/accept gates treat it as
 * an honest shortfall — never leave awaitingPropSlots as the terminal stash.
 */
export function ticketStashForTerminalPaint<
  T extends {
    awaitingPropSlots?: boolean;
    scanComplete?: boolean;
  },
>(stash: T, opts: { pastPropSlotDeadline: boolean }): T {
  if (!stash.awaitingPropSlots) return stash;
  if (stash.scanComplete === true || opts.pastPropSlotDeadline) {
    const { awaitingPropSlots: _drop, ...rest } = stash;
    return rest as T;
  }
  return stash;
}

export function ticketResolvePhase(opts: {
  displayedPickCount: number;
  stashPickCount: number;
  stashPropCount: number;
  awaitingPropSlots?: boolean;
  scanComplete?: boolean | null;
  boardScanPending?: boolean;
}): TicketDeliveryPhase {
  if (opts.displayedPickCount > 0) {
    if (opts.scanComplete === true) return "shown-mixed";
    return "shown-mixed";
  }
  if (opts.scanComplete === true) {
    return opts.stashPickCount > 0 ? "shown-shortfall" : "empty-complete";
  }
  if (
    opts.awaitingPropSlots &&
    opts.stashPropCount <= 0 &&
    opts.stashPickCount > 0
  ) {
    return "awaiting-props";
  }
  if (opts.stashPickCount > 0) return "stashed-held";
  if (opts.boardScanPending) return "scanning";
  return "idle";
}

export function ticketIsTerminal(phase: TicketDeliveryPhase): boolean {
  return (
    phase === "shown-mixed" ||
    phase === "shown-shortfall" ||
    phase === "empty-complete" ||
    phase === "failed-retry"
  );
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
