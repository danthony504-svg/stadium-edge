/**
 * Composer unlock policy after a Coach ticket is on screen.
 * Does not change picks, staging, or board-scan scoring — only busy flags.
 */

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
}): boolean {
  if (!opts.hasUserTurn) return false;
  if (!opts.streaming && !opts.buildFinishing && !opts.waiting) return false;
  const scanComplete =
    opts.boardScanComplete === true || opts.stashScanComplete === true;
  const fullCount =
    (opts.ticketLegTarget ?? 0) > 0 &&
    (opts.displayedPickCount ?? 0) >= (opts.ticketLegTarget ?? 0);
  if (opts.assistantHasPicks) {
    return (
      scanComplete ||
      fullCount ||
      opts.hasScanManifest ||
      opts.liveScanDelivered === true
    );
  }
  return opts.hasScanManifest && scanComplete;
}
