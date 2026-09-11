/**
 * Coach ticket *display* policy for in-flight board scans.
 * Does not change staging, qualification, simulation, or delivery gates —
 * only whether incomplete restaged pick cards are shown in the chat bubble.
 */

/** Fixed-leg live scans restage every wave (legs add/remove). Hold cards until complete. */
export function shouldHoldIncompleteBoardScanPickDisplay(opts: {
  scanComplete?: boolean | null;
  legTarget: number;
  /** Slate seed / explicit preview flashes may still show incomplete picks. */
  allowIncompletePicks?: boolean;
}): boolean {
  if (opts.allowIncompletePicks) return false;
  if (opts.scanComplete === true) return false;
  return opts.legTarget >= 3;
}
