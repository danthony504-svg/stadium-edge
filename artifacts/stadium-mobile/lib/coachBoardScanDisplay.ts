/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether pick cards are shown / replaced in the chat bubble.
 *
 * Fixed-leg same-request rules:
 * - Hold under-count cards (no 2→4 drip).
 * - Once scored N of N (or scanComplete shortfall), paint + freeze — never sit
 *   permanently at "Scored N of N" @ 93% waiting on scanComplete.
 * - Frozen finished tickets reject late reshape / post-freeze sim mutations.
 * - New Ask / Try Again starts a new request and is unaffected.
 */

/** Prefer the larger of gated progress vs raw stash — never `||` (4 || 6 === 4). */
export function boardScanDisplayReadyCount(
  gatedPickCount: number,
  stashPickCount: number,
): number {
  return Math.max(gatedPickCount || 0, stashPickCount || 0);
}

/**
 * Soft scored progress when qualifying candidates exist but the staged ticket
 * is still empty. Caps below N for fixed-leg asks so freeze / N-of-N release
 * never fires on a zero-card bubble.
 */
export function boardScanSoftProgressLegCount(
  totalQualified: number,
  legTarget: number,
): number {
  if (totalQualified <= 0) return 0;
  if (legTarget < 3) return Math.min(totalQualified, Math.max(legTarget, 1));
  return Math.min(totalQualified, legTarget - 1);
}

/**
 * Hard gate: fixed-leg cards after full scored count, scanComplete, or stall escape.
 * Under-count mid-scan flashes must not paint.
 */
export function canShowFixedLegBoardScanPicks(opts: {
  legTarget: number;
  pickCount: number;
  scanComplete?: boolean | null;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
  /** @deprecated Ignored — under-count mid-scan flash still blocked. */
  stashPickCount?: number;
}): boolean {
  if (opts.pickCount <= 0) return false;
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return true;
  if (opts.legTarget < 3) return true;
  if (opts.scanComplete === true) return true;
  // Scored all requested legs — finished ticket is ready; do not wait on scanComplete.
  return opts.pickCount >= opts.legTarget;
}

/**
 * Fixed-leg live scans: hold under-count pick cards.
 * Release when scored N of N, scanComplete, or stall escape.
 */
export function shouldHoldIncompleteBoardScanPickDisplay(opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  /** Qualified / restaged pick count currently in the scan stash (progress only). */
  readyPickCount?: number;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
}): boolean {
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return false;
  if (opts.scanComplete === true) return false;
  if (opts.legTarget < 3) return false;
  // Full scored count is ready for handoff — do not hold at 93% for scanComplete.
  if ((opts.readyPickCount ?? 0) >= opts.legTarget) return false;
  return true;
}

/**
 * Under-count restages may blank held cards (re-hold).
 * Protect a completed (frozen) on-screen ticket from being blanked.
 */
export function shouldBlankHeldBoardScanPickDisplay(opts: {
  holdIncomplete: boolean;
  displayedPickCount: number;
  legTarget?: number;
  displayedScanComplete?: boolean | null;
}): boolean {
  if (!opts.holdIncomplete) return false;
  if (
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: opts.displayedScanComplete,
      displayedPickCount: opts.displayedPickCount,
      legTarget: opts.legTarget ?? 0,
    })
  ) {
    return false;
  }
  return true;
}

/**
 * Finished same-request ticket is frozen:
 * - full scored count on screen, or
 * - scanComplete delivery (including honest shortfall / zero).
 */
export function shouldFreezeDisplayedCoachTicket(opts: {
  displayedScanComplete?: boolean | null;
  displayedPickCount: number;
  legTarget: number;
}): boolean {
  if (opts.legTarget >= 3 && opts.displayedPickCount >= opts.legTarget) {
    return true;
  }
  if (opts.displayedScanComplete !== true) return false;
  if (opts.legTarget < 3) return opts.displayedPickCount > 0;
  // Fixed-leg: any completed delivery (including 0-pick + manifest) is finished.
  return true;
}

/**
 * Same-request ticket update gate.
 * Frozen finished tickets reject replacements (including duplicate finals).
 * Exception: frozen empty may accept a completed non-empty recovery.
 * Empty/under-count visible tickets accept full-count or completed results.
 */
export function shouldAcceptSameRequestBoardScanTicketUpdate(opts: {
  displayedScanComplete?: boolean | null;
  displayedPickCount: number;
  incomingScanComplete?: boolean | null;
  incomingPickCount: number;
  legTarget: number;
  /** Stall / late-join escape — accept under-count paint. */
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
}): boolean {
  // Escape latch must win over fixed-leg full-count gating. Without this,
  // releaseUnderCountBoardScanEscape sets forceShow then patchInstant still
  // rejects under-count tickets and returns a fake success with zero cards.
  if (
    (opts.allowIncompletePicks || opts.forceShowIncomplete) &&
    opts.incomingPickCount > 0
  ) {
    // Still protect a frozen finished on-screen ticket from reshape.
    if (
      shouldFreezeDisplayedCoachTicket({
        displayedScanComplete: opts.displayedScanComplete,
        displayedPickCount: opts.displayedPickCount,
        legTarget: opts.legTarget,
      }) &&
      opts.displayedPickCount > 0
    ) {
      return false;
    }
    return true;
  }
  if (
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: opts.displayedScanComplete,
      displayedPickCount: opts.displayedPickCount,
      legTarget: opts.legTarget,
    })
  ) {
    // Visible finished ticket stays frozen. Empty frozen may recover to a
    // completed non-empty ticket (handoff after a zeroed delivery race).
    if (
      opts.displayedPickCount === 0 &&
      opts.incomingScanComplete === true &&
      opts.incomingPickCount > 0
    ) {
      return true;
    }
    return false;
  }
  if (opts.legTarget < 3) return true;
  if (opts.incomingScanComplete === true) return true;
  // First full-count paint while visible is still empty / under-count.
  return (
    opts.incomingPickCount >= opts.legTarget &&
    opts.displayedPickCount < opts.legTarget
  );
}

/**
 * Fixed-leg progress %: cards on screen → 100%; otherwise scored floor ≤ 93%.
 * Scored N of N must hand off to displayed cards (100%) — not sit at 93%.
 */
export function boardScanDisplayProgressPct(opts: {
  displayedLegCount: number;
  scoredLegCount: number;
  legTarget: number;
}): number {
  if (opts.displayedLegCount > 0) return 100;
  if (opts.legTarget > 0 && opts.scoredLegCount > 0) {
    const scored = Math.min(opts.scoredLegCount, opts.legTarget);
    return Math.min(93, Math.round(40 + (53 * scored) / opts.legTarget));
  }
  return 0;
}

/**
 * True when the finished ticket should hand off (paint → 100%).
 * Scored N of N is enough — do not require scanComplete.
 * Honest shortfalls still need scanComplete.
 */
export function canCompleteFixedLegBoardScanHandoff(opts: {
  legTarget: number;
  scoredLegCount: number;
  scanComplete?: boolean | null;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
}): boolean {
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) {
    return opts.scoredLegCount > 0;
  }
  if (opts.legTarget < 3) return opts.scoredLegCount > 0;
  if (opts.scoredLegCount >= opts.legTarget) return true;
  return opts.scanComplete === true && opts.scoredLegCount > 0;
}

/**
 * Permanent 93% bug: full scored stash with no cards on screen.
 * (scanComplete may still be false — that wait is the bug.)
 */
export function isPermanentBoardScan93PctState(opts: {
  legTarget: number;
  scoredLegCount: number;
  displayedLegCount: number;
  scanComplete?: boolean | null;
}): boolean {
  if (opts.displayedLegCount > 0) return false;
  if (opts.legTarget < 3) return false;
  return opts.scoredLegCount >= opts.legTarget;
}

/**
 * After a finished same-request ticket is frozen, sim/rescore must not mutate
 * the visible picks/odds/grades/confidence/edge/ordering.
 */
export function shouldBlockPostFreezeTicketDisplayMutation(opts: {
  frozen: boolean;
  legTarget: number;
}): boolean {
  return opts.frozen === true && opts.legTarget >= 3;
}
