/**
 * Coach build-phase UI handoff — thin adapters over ticketDelivery.ts.
 * All terminal / escape / busy / stall decisions live in ticketDelivery.
 * This file keeps historical export names so coach.tsx call sites stay stable.
 */

import {
  createTicketDeliveryClock,
  emptyTicketDeadEndMessage as ticketEmptyDeadEndMessage,
  resetTicketDeliveryClock,
  ticketAwaitingPropSlotsElapsedMs,
  ticketAwaitingPropSlotsMaxWaitMs,
  ticketAwaitingPropSlotsPastDeadline,
  ticketEmptyCardStallMs,
  ticketEscapeWindowMs,
  ticketGameLineOnlyEscapeMs,
  ticketIsTerminal,
  ticketNoteAwaitingPropSlots,
  ticketProgressCopy,
  ticketResolvePhase,
  ticketShouldArmEscapeDeadline,
  ticketShouldEscapeUnderCount,
  ticketShouldKeepBusy,
  ticketShouldReArmStallPoke,
  ticketShouldSuppressEmptyDeadEnd,
  ticketStashForTerminalPaint,
  ticketUnderCountEscapeMs,
  type TicketDeliveryClock,
  type TicketDeliveryPhase,
} from "./ticketDelivery.ts";

export {
  createTicketDeliveryClock,
  resetTicketDeliveryClock,
  ticketAwaitingPropSlotsElapsedMs,
  ticketAwaitingPropSlotsMaxWaitMs,
  ticketAwaitingPropSlotsPastDeadline,
  ticketEscapeWindowMs,
  ticketNoteAwaitingPropSlots,
  ticketProgressCopy,
  ticketResolvePhase,
  ticketStashForTerminalPaint,
  ticketIsTerminal,
  type TicketDeliveryClock,
  type TicketDeliveryPhase,
};

/** Keep "board-scan" (not "stream"/"score") until pick cards actually land. */
export function coachPhaseWhileAwaitingTicketCards(opts: {
  displayedPickCount: number;
  stashPickCount: number;
}): "board-scan" | "stream" {
  if (opts.displayedPickCount > 0) return "stream";
  if (opts.stashPickCount > 0) return "board-scan";
  return "board-scan";
}

export function shouldClearBusyAfterFailedStallPaint(opts: {
  hadStashPicks: boolean;
  displayedPickCountAfter: number;
  incompleteScanInFlight?: boolean;
}): boolean {
  if (opts.displayedPickCountAfter > 0) return false;
  if (opts.incompleteScanInFlight) return false;
  return true;
}

export function emptyCardBoardScanStallMs(requestedLegs: number): number {
  return ticketEmptyCardStallMs(requestedLegs);
}

export function underCountHeldBoardScanEscapeMs(requestedLegs: number): number {
  return ticketUnderCountEscapeMs(requestedLegs);
}

export function underCountHeldBoardScanEscapeMsForStash(opts: {
  requestedLegs: number;
  stashPropCount: number;
}): number {
  if (opts.stashPropCount > 0) return ticketUnderCountEscapeMs(opts.requestedLegs);
  return ticketGameLineOnlyEscapeMs(opts.requestedLegs);
}

export function awaitingPropSlotsMaxWaitMs(requestedLegs: number): number {
  return ticketAwaitingPropSlotsMaxWaitMs(requestedLegs);
}

export function underCountEscapeWindowMsForStash(opts: {
  requestedLegs: number;
  stashPropCount: number;
  awaitingPropSlots?: boolean;
  scanComplete?: boolean | null;
}): number {
  return ticketEscapeWindowMs(opts);
}

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
    // Unknown prop count → short under-count escape (legacy callers).
    // Explicit 0 / awaitingPropSlots uses the longer ticketEscapeWindow.
    if (opts.stashPropCount == null && !opts.awaitingPropSlots) {
      return ticketUnderCountEscapeMs(opts.requestedLegs);
    }
    return ticketEscapeWindowMs({
      requestedLegs: opts.requestedLegs,
      stashPropCount: opts.stashPropCount ?? 0,
      awaitingPropSlots: opts.awaitingPropSlots,
      scanComplete: opts.scanComplete,
    });
  }
  return ticketEmptyCardStallMs(opts.requestedLegs);
}

export function shouldKeepBusyForIncompleteBoardScan(opts: {
  isParlayBuild: boolean;
  legTarget: number;
  displayedPickCount: number;
  scanComplete: boolean | null | undefined;
  hasScanStash: boolean;
  ticketFrozen?: boolean;
  boardScanPending?: boolean;
  forceShowIncomplete?: boolean;
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  void opts.forceShowIncomplete;
  return ticketShouldKeepBusy(opts);
}

export function shouldSuppressEmptyTicketDeadEnd(opts: {
  boardScanPending: boolean;
  scanComplete: boolean | null | undefined;
  hasScanStash: boolean;
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  return ticketShouldSuppressEmptyDeadEnd(opts);
}

/**
 * Escape gate. Prefer passing awaitingPropSlotsWaitElapsedMs from the delivery
 * clock — omitting it blocks reserved 0-prop previews forever (84% limbo).
 */
export function shouldReleaseUnderCountBoardScanAtEscape(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
  awaitingPropSlotsWaitElapsedMs?: number;
  requestedLegs?: number;
}): boolean {
  return ticketShouldEscapeUnderCount({
    stashPickCount: opts.stashPickCount,
    displayedPickCount: opts.displayedPickCount,
    awaitingPropSlots: opts.awaitingPropSlots,
    stashPropCount: opts.stashPropCount,
    scanComplete: opts.scanComplete,
    waitElapsedMs: opts.awaitingPropSlotsWaitElapsedMs ?? 0,
    requestedLegs: opts.requestedLegs ?? 6,
  });
}

export function shouldArmUnderCountEscapeDeadline(opts: {
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
}): boolean {
  return ticketShouldArmEscapeDeadline(opts);
}

export function shouldEndBoardScanAttemptAfterLateJoins(opts: {
  lateJoinsRemaining: number;
}): boolean {
  return opts.lateJoinsRemaining <= 0;
}

export function stallIncompleteScanStillInFlight(opts: {
  forceShowIncomplete: boolean;
  boardScanPending: boolean;
  scanComplete: boolean | null | undefined;
  stashPickCount: number;
  displayedPickCount: number;
  awaitingPropSlotsPastDeadline?: boolean;
}): boolean {
  if (opts.displayedPickCount > 0) return false;
  if (opts.scanComplete === true) return false;
  if (opts.awaitingPropSlotsPastDeadline) return false;
  if (opts.boardScanPending) return true;
  if (opts.stashPickCount > 0) return true;
  void opts.forceShowIncomplete;
  return false;
}

export function shouldReArmBoardScanStallPoke(opts: {
  displayedPickCount: number;
  awaitingPropSlotsPastDeadline?: boolean;
  absoluteStallBudgetExhausted?: boolean;
}): boolean {
  return ticketShouldReArmStallPoke(opts);
}

export function coachBoardScanProgressCopy(opts: {
  scoredLegCount: number;
  requestedLegs: number;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
}): string | null {
  return ticketProgressCopy(opts);
}

export function emptyTicketDeadEndMessage(opts: {
  boardScanPending: boolean;
  scanComplete?: boolean | null;
}): string {
  return ticketEmptyDeadEndMessage(opts);
}

/** Helper: past-deadline from a live delivery clock. */
export function awaitingPropSlotsPastDeadlineFromClock(opts: {
  clock: TicketDeliveryClock;
  awaitingPropSlots?: boolean;
  stashPropCount?: number;
  scanComplete?: boolean | null;
  requestedLegs: number;
  now?: number;
}): boolean {
  return ticketAwaitingPropSlotsPastDeadline({
    awaitingPropSlots: opts.awaitingPropSlots,
    stashPropCount: opts.stashPropCount,
    scanComplete: opts.scanComplete,
    requestedLegs: opts.requestedLegs,
    waitElapsedMs: ticketAwaitingPropSlotsElapsedMs(opts.clock, opts.now),
  });
}
