/** A board scan may finish short, but an incomplete scan may only terminalize at its final ticket target. */
export function coachBoardScanMayTerminalize(opts: {
  requestedLegs: number;
  finalizedPickCount: number;
  scanComplete?: boolean;
}): boolean {
  return opts.scanComplete === true ||
    (opts.requestedLegs > 0 && opts.finalizedPickCount >= opts.requestedLegs);
}
