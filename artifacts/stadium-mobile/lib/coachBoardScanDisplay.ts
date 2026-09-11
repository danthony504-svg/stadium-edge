/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether pick cards are shown / replaced in the chat bubble.
 *
 * Fixed-leg same-request rules:
 * - Hold cards until scanComplete (no 2→4 drip, no mid-scan reshape).
 * - Once a completed ticket is displayed, freeze it for that request.
 * - Late incomplete / lower-quality snapshots must not replace it.
 * - Authoritative completed may replace only while the visible ticket is
 *   still explicitly incomplete (or empty).
 * New Ask / Try Again starts a new request and is unaffected.
 */

/** Prefer the larger of gated progress vs raw stash — never `||` (4 || 6 === 4). */
export function boardScanDisplayReadyCount(
  gatedPickCount: number,
  stashPickCount: number,
): number {
  return Math.max(gatedPickCount || 0, stashPickCount || 0);
}

/**
 * Hard gate: fixed-leg cards only after scanComplete (or stall escape).
 * Mid-scan full-count flashes are not "final" and must not paint.
 */
export function canShowFixedLegBoardScanPicks(opts: {
  legTarget: number;
  pickCount: number;
  scanComplete?: boolean | null;
  allowIncompletePicks?: boolean;
  forceShowIncomplete?: boolean;
  /** @deprecated Ignored — mid-scan stash-full flash removed to stop reshape. */
  stashPickCount?: number;
}): boolean {
  if (opts.pickCount <= 0) return false;
  if (opts.allowIncompletePicks || opts.forceShowIncomplete) return true;
  if (opts.legTarget < 3) return true;
  return opts.scanComplete === true;
}

/** Fixed-leg live scans: hold pick cards until scanComplete / stall escape. */
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
  // Do not release on ready >= target — mid-scan full count still restages.
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

/** Completed same-request ticket (full or honest shortfall / zero) is frozen. */
export function shouldFreezeDisplayedCoachTicket(opts: {
  displayedScanComplete?: boolean | null;
  displayedPickCount: number;
  legTarget: number;
}): boolean {
  if (opts.displayedScanComplete !== true) return false;
  if (opts.legTarget < 3) return opts.displayedPickCount > 0;
  // Fixed-leg: any completed delivery (including 0-pick + manifest) is finished.
  return true;
}

/**
 * Same-request ticket update gate.
 * Frozen finished tickets reject all replacements (including duplicate finals).
 * Incomplete/empty visible tickets accept only authoritative completed results.
 */
export function shouldAcceptSameRequestBoardScanTicketUpdate(opts: {
  displayedScanComplete?: boolean | null;
  displayedPickCount: number;
  incomingScanComplete?: boolean | null;
  incomingPickCount: number;
  legTarget: number;
}): boolean {
  if (
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: opts.displayedScanComplete,
      displayedPickCount: opts.displayedPickCount,
      legTarget: opts.legTarget,
    })
  ) {
    return false;
  }
  if (opts.legTarget < 3) return true;
  // Visible still incomplete/empty — only completed authoritative results land.
  return opts.incomingScanComplete === true;
}
