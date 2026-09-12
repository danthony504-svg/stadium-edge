/**
 * TicketDeliverySession — one mutable authority per Coach send.
 *
 * Why this exists (root cause of forever-84%):
 *   ticketDelivery helpers were sound alone, but coach.tsx kept parallel
 *   clocks / forceShow / keepBusy / late-join flags that disagreed. A hung
 *   prop MC left boardScanPending=true while the prop-slot clock was null
 *   or cleared → keepBusy stayed true → AnalysisProgress frozen at 84% with
 *   "Scoring player props…" and Final unchecked.
 *
 * Contract for every send:
 *   Within the absolute UI budget (or the shorter prop-slot wait), the session
 *   MUST latch a terminal outcome. After that:
 *     - keepBusy is always false (boardScanPending cannot re-busy)
 *     - pick hold is always open (forceShow)
 *     - awaitingPropSlots is stripped from paint
 *     - later partials may UPGRADE cards but cannot re-enter awaiting-props
 */

import {
  createTicketDeliveryClock,
  resetTicketDeliveryClock,
  ticketAwaitingPropSlotsElapsedMs,
  ticketAwaitingPropSlotsMaxWaitMs,
  ticketAwaitingPropSlotsPastDeadline,
  ticketIsTerminal,
  ticketNoteAwaitingPropSlots,
  ticketResolvePhase,
  ticketStashForTerminalPaint,
  type TicketDeliveryClock,
  type TicketDeliveryPhase,
} from "./ticketDelivery.ts";

export type TicketDeliveryOutcomeKind =
  | "open"
  | "shown-mixed"
  | "shown-shortfall"
  | "empty-complete"
  | "failed-retry";

export type TicketDeliverySession = {
  sendGen: number;
  requestedLegs: number;
  clock: TicketDeliveryClock;
  /** Latched once — never cleared except beginSend. */
  forceShow: boolean;
  outcome: TicketDeliveryOutcomeKind;
  outcomeAtMs: number | null;
  hardTerminalTimer: ReturnType<typeof setTimeout> | null;
  /** Absolute UI budget timer — independent of prop-slot hard terminal. */
  absoluteTerminalTimer: ReturnType<typeof setTimeout> | null;
};

/** Absolute UI budget from send start — must unlock even with no reserved preview. */
export function ticketAbsoluteUiBudgetMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 90_000;
  if (requestedLegs >= 9) return 75_000;
  if (requestedLegs >= 6) return 45_000;
  return 40_000;
}

export function createTicketDeliverySession(
  sendGen: number,
  requestedLegs: number,
  now = Date.now(),
): TicketDeliverySession {
  return {
    sendGen,
    requestedLegs: Math.max(0, requestedLegs),
    clock: createTicketDeliveryClock(now),
    forceShow: false,
    outcome: "open",
    outcomeAtMs: null,
    hardTerminalTimer: null,
    absoluteTerminalTimer: null,
  };
}

export function beginTicketDeliverySession(
  session: TicketDeliverySession,
  opts: { sendGen: number; requestedLegs: number; now?: number },
): void {
  clearTicketDeliveryHardTerminal(session);
  if (session.absoluteTerminalTimer) {
    clearTimeout(session.absoluteTerminalTimer);
    session.absoluteTerminalTimer = null;
  }
  session.sendGen = opts.sendGen;
  session.requestedLegs = Math.max(0, opts.requestedLegs);
  resetTicketDeliveryClock(session.clock, opts.now ?? Date.now());
  session.forceShow = false;
  session.outcome = "open";
  session.outcomeAtMs = null;
}

export function ticketDeliverySessionIsTerminal(
  session: TicketDeliverySession,
): boolean {
  return session.outcome !== "open";
}

export function clearTicketDeliveryHardTerminal(
  session: TicketDeliverySession,
): void {
  if (session.hardTerminalTimer) {
    clearTimeout(session.hardTerminalTimer);
    session.hardTerminalTimer = null;
  }
}

export function latchTicketDeliveryTerminal(
  session: TicketDeliverySession,
  kind: Exclude<TicketDeliveryOutcomeKind, "open">,
  now = Date.now(),
): void {
  clearTicketDeliveryHardTerminal(session);
  session.forceShow = true;
  if (session.outcome === "open") {
    session.outcome = kind;
    session.outcomeAtMs = now;
  }
}

export function ticketDeliveryAbsolutePastDeadline(
  session: TicketDeliverySession,
  now = Date.now(),
): boolean {
  const started = session.clock.sendStartedAtMs;
  if (started == null) return false;
  return now - started >= ticketAbsoluteUiBudgetMs(session.requestedLegs || 6);
}

export function ticketDeliveryPropSlotPastDeadline(
  session: TicketDeliverySession,
  opts: {
    awaitingPropSlots?: boolean;
    stashPropCount?: number;
    scanComplete?: boolean | null;
    now?: number;
  },
): boolean {
  if (ticketDeliverySessionIsTerminal(session)) return true;
  return ticketAwaitingPropSlotsPastDeadline({
    awaitingPropSlots: opts.awaitingPropSlots,
    stashPropCount: opts.stashPropCount,
    scanComplete: opts.scanComplete,
    requestedLegs: session.requestedLegs || 6,
    waitElapsedMs: ticketAwaitingPropSlotsElapsedMs(
      session.clock,
      opts.now ?? Date.now(),
    ),
  });
}

/**
 * Keep busy? Terminal latch / absolute budget / prop-slot deadline always win
 * over boardScanPending — that was the forever-84% bug.
 */
export function ticketDeliveryShouldKeepBusy(
  session: TicketDeliverySession,
  opts: {
    isParlayBuild: boolean;
    displayedPickCount: number;
    scanComplete?: boolean | null;
    hasScanStash: boolean;
    ticketFrozen?: boolean;
    boardScanPending?: boolean;
    awaitingPropSlots?: boolean;
    stashPropCount?: number;
    now?: number;
  },
): boolean {
  if (!opts.isParlayBuild || session.requestedLegs < 3) return false;
  if (ticketDeliverySessionIsTerminal(session)) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.ticketFrozen) return false;
  if (ticketDeliveryAbsolutePastDeadline(session, opts.now)) return false;
  if (
    ticketDeliveryPropSlotPastDeadline(session, {
      awaitingPropSlots: opts.awaitingPropSlots,
      stashPropCount: opts.stashPropCount,
      scanComplete: opts.scanComplete,
      now: opts.now,
    })
  ) {
    return false;
  }
  if (opts.scanComplete === true) return false;
  if (opts.boardScanPending) return true;
  if (!opts.hasScanStash) return false;
  return true;
}

export function ticketDeliveryShouldHoldIncompletePicks(
  session: TicketDeliverySession,
  opts: {
    scanComplete?: boolean | null;
    legTarget: number;
    readyPickCount: number;
    allowIncompletePicks?: boolean;
    awaitingPropSlots?: boolean;
    stashPropCount?: number;
    now?: number;
  },
): boolean {
  if (opts.scanComplete === true) return false;
  if (opts.legTarget < 3) return false;
  if (opts.readyPickCount >= opts.legTarget) return false;
  if (opts.allowIncompletePicks || session.forceShow) return false;
  if (ticketDeliverySessionIsTerminal(session)) return false;
  if (ticketDeliveryAbsolutePastDeadline(session, opts.now)) return false;
  if (
    ticketDeliveryPropSlotPastDeadline(session, {
      awaitingPropSlots: opts.awaitingPropSlots,
      stashPropCount: opts.stashPropCount,
      scanComplete: opts.scanComplete,
      now: opts.now,
    })
  ) {
    return false;
  }
  return true;
}

export function ticketDeliveryNotePartial(
  session: TicketDeliverySession,
  opts: {
    awaitingPropSlots?: boolean;
    stashPropCount: number;
    now?: number;
  },
): void {
  if (ticketDeliverySessionIsTerminal(session)) {
    // After terminal, never re-stamp awaiting clock — upgrades only.
    return;
  }
  ticketNoteAwaitingPropSlots({
    clock: session.clock,
    awaitingPropSlots: opts.awaitingPropSlots,
    stashPropCount: opts.stashPropCount,
    now: opts.now,
  });
}

export function ticketDeliveryShouldArmHardTerminal(
  session: TicketDeliverySession,
  opts: {
    stashPickCount: number;
    displayedPickCount: number;
    awaitingPropSlots?: boolean;
    stashPropCount?: number;
    scanComplete?: boolean | null;
  },
): boolean {
  if (ticketDeliverySessionIsTerminal(session)) return false;
  if (session.hardTerminalTimer) return false;
  if (opts.displayedPickCount > 0) return false;
  if (opts.stashPickCount <= 0) return false;
  if (opts.scanComplete === true) return false;
  return opts.awaitingPropSlots === true && (opts.stashPropCount ?? 0) <= 0;
}

export function ticketDeliveryArmHardTerminal(
  session: TicketDeliverySession,
  opts: {
    onFire: () => void;
    now?: number;
  },
): boolean {
  if (ticketDeliverySessionIsTerminal(session)) return false;
  if (session.hardTerminalTimer) return false;
  const now = opts.now ?? Date.now();
  if (session.clock.awaitingPropSlotsStartedAtMs == null) {
    session.clock.awaitingPropSlotsStartedAtMs = now;
  }
  const startedAt = session.clock.awaitingPropSlotsStartedAtMs;
  const elapsed = Math.max(0, now - startedAt);
  const waitMs = Math.max(
    0,
    ticketAwaitingPropSlotsMaxWaitMs(session.requestedLegs || 6) - elapsed,
  );
  session.hardTerminalTimer = setTimeout(() => {
    session.hardTerminalTimer = null;
    opts.onFire();
  }, waitMs);
  return true;
}

export function ticketDeliveryStashForPaint<
  T extends { awaitingPropSlots?: boolean; scanComplete?: boolean },
>(
  session: TicketDeliverySession,
  stash: T,
  opts?: {
    awaitingPropSlots?: boolean;
    stashPropCount?: number;
    now?: number;
  },
): T {
  const past =
    ticketDeliverySessionIsTerminal(session) ||
    ticketDeliveryAbsolutePastDeadline(session, opts?.now) ||
    ticketDeliveryPropSlotPastDeadline(session, {
      awaitingPropSlots:
        opts?.awaitingPropSlots ?? stash.awaitingPropSlots === true,
      stashPropCount: opts?.stashPropCount ?? 0,
      scanComplete: stash.scanComplete,
      now: opts?.now,
    });
  return ticketStashForTerminalPaint(stash, { pastPropSlotDeadline: past });
}

export function ticketDeliveryResolvePhase(
  session: TicketDeliverySession,
  opts: {
    displayedPickCount: number;
    stashPickCount: number;
    stashPropCount: number;
    awaitingPropSlots?: boolean;
    scanComplete?: boolean | null;
    boardScanPending?: boolean;
  },
): TicketDeliveryPhase {
  if (session.outcome === "shown-mixed") return "shown-mixed";
  if (session.outcome === "shown-shortfall") return "shown-shortfall";
  if (session.outcome === "empty-complete") return "empty-complete";
  if (session.outcome === "failed-retry") return "failed-retry";
  // Past deadline but not yet latched — drop "awaiting-props" so UI copy
  // cannot keep saying "Scoring player props…".
  if (
    ticketDeliveryAbsolutePastDeadline(session) ||
    ticketDeliveryPropSlotPastDeadline(session, {
      awaitingPropSlots: opts.awaitingPropSlots,
      stashPropCount: opts.stashPropCount,
      scanComplete: opts.scanComplete,
    })
  ) {
    if (opts.displayedPickCount > 0) return "shown-mixed";
    if (opts.stashPickCount > 0) return "stashed-held";
    return opts.boardScanPending ? "scanning" : "idle";
  }
  return ticketResolvePhase(opts);
}

export { ticketIsTerminal, ticketAwaitingPropSlotsMaxWaitMs };
