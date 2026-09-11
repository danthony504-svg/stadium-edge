/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether pick cards are shown / replaced in the chat bubble.
 *
 * Fixed-leg same-request rules:
 * - Hold cards until scanComplete (no 2→4 drip, no mid-scan reshape).
 * - Scored N of N @ 93% is temporary until scanComplete handoff → 100%.
 * - Once a completed ticket is displayed, freeze it for that request.
 * - Post-freeze sim/rescore must not mutate the visible finished ticket.
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
 * Frozen finished tickets reject replacements (including duplicate finals).
 * Exception: frozen empty may accept a completed non-empty recovery so
 * "Scored N of N" never stays permanently stuck after scanComplete.
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
  // Visible still incomplete/empty — only completed authoritative results land.
  return opts.incomingScanComplete === true;
}

/**
 * Fixed-leg progress %: cards on screen → 100%; otherwise scored floor ≤ 93%.
 * Mid-scan "Scored N of N" is temporary; handoff to 100% when the finished
 * ticket is displayed after scanComplete.
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
 * True when scored N of N + scanComplete should hand off to the final ticket
 * (and 100%). Mid-scan full score alone is not enough — keep #451 hold.
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
  return opts.scanComplete === true && opts.scoredLegCount > 0;
}

/**
 * Permanent 93% bug state: scan finished with a full scored stash but no cards.
 * Temporary mid-scan "Scored N of N" @ 93% (scanComplete false) is not permanent.
 */
export function isPermanentBoardScan93PctState(opts: {
  legTarget: number;
  scoredLegCount: number;
  displayedLegCount: number;
  scanComplete?: boolean | null;
}): boolean {
  if (opts.displayedLegCount > 0) return false;
  if (opts.scanComplete !== true) return false;
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
