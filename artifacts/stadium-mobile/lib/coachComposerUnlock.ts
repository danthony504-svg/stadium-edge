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
  boardScanComplete?: boolean | null;
  stashScanComplete?: boolean | null;
  hasScanManifest: boolean;
  liveScanDelivered?: boolean;
}): boolean {
  if (!opts.hasUserTurn) return false;
  if (!opts.streaming && !opts.buildFinishing && !opts.waiting) return false;
  const scanComplete =
    opts.boardScanComplete === true || opts.stashScanComplete === true;
  if (opts.assistantHasPicks) {
    return scanComplete || opts.hasScanManifest || opts.liveScanDelivered === true;
  }
  return opts.hasScanManifest && scanComplete;
}
