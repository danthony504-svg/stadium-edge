/**
 * Composer unlock / send policy after a Coach ticket is on screen.
 * Does not change picks, staging, board-scan scoring, freeze, or selection —
 * only busy flags and whether the send control may fire.
 */

/** Finished ticket visible — full count, completed scan, or frozen delivery. */
export function isFinishedCoachTicketOnScreen(opts: {
  displayedPickCount: number;
  ticketLegTarget?: number;
  boardScanComplete?: boolean | null;
  ticketFrozen?: boolean;
  hasScanManifest?: boolean;
}): boolean {
  if (opts.ticketFrozen === true) {
    return opts.displayedPickCount > 0 || opts.hasScanManifest === true || opts.boardScanComplete === true;
  }
  if (opts.boardScanComplete === true) {
    return opts.displayedPickCount > 0 || opts.hasScanManifest === true;
  }
  const target = opts.ticketLegTarget ?? 0;
  return target >= 3 && opts.displayedPickCount >= target;
}

export function shouldUnlockCoachComposer(opts: {
  hasUserTurn: boolean;
  streaming: boolean;
  buildFinishing: boolean;
  waiting: boolean;
  assistantHasPicks: boolean;
  displayedPickCount?: number;
  ticketLegTarget?: number;
  boardScanComplete?: boolean | null;
  stashScanComplete?: boolean | null;
  hasScanManifest: boolean;
  liveScanDelivered?: boolean;
  ticketFrozen?: boolean;
}): boolean {
  if (!opts.hasUserTurn) return false;
  if (!opts.streaming && !opts.buildFinishing && !opts.waiting) return false;
  const scanComplete =
    opts.boardScanComplete === true || opts.stashScanComplete === true;
  const fullCount =
    (opts.ticketLegTarget ?? 0) > 0 &&
    (opts.displayedPickCount ?? 0) >= (opts.ticketLegTarget ?? 0);
  const finished = isFinishedCoachTicketOnScreen({
    displayedPickCount: opts.displayedPickCount ?? 0,
    ticketLegTarget: opts.ticketLegTarget,
    boardScanComplete: opts.boardScanComplete,
    ticketFrozen: opts.ticketFrozen,
    hasScanManifest: opts.hasScanManifest,
  });
  if (opts.assistantHasPicks || finished) {
    return (
      finished ||
      scanComplete ||
      fullCount ||
      opts.hasScanManifest ||
      opts.liveScanDelivered === true
    );
  }
  return opts.hasScanManifest && scanComplete;
}

/**
 * Send control may fire when the user has typed a new ask after a finished
 * ticket — even if streaming/waiting flags are still sticky.
 */
export function shouldAllowCoachComposerSend(opts: {
  hasInput: boolean;
  coachBuildInFlight: boolean;
  isParlayBuildAsk: boolean;
  finishedTicketOnScreen: boolean;
}): boolean {
  if (!opts.hasInput) return false;
  if (opts.finishedTicketOnScreen) return true;
  if (opts.isParlayBuildAsk) return true;
  return !opts.coachBuildInFlight;
}
