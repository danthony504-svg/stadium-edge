/** Partial scans continue in the background without locking visible results. */
export function coachSubmitIsBlocked(opts: {
  requestActive: boolean;
  hasVisiblePartialPicks: boolean;
}): boolean {
  return opts.requestActive;
}

/** Existing cards, navigation, and slip controls stay interactive during a scan. */
export function coachScreenInteractionEnabled(opts: {
  requestActive: boolean;
  hasVisiblePartialPicks: boolean;
}): boolean {
  return !opts.requestActive || opts.hasVisiblePartialPicks;
}

/** Coalesce scan waves without scheduling a separate JS task. */
export function shouldEmitPartialUpdate(
  nowMs: number,
  lastEmissionMs: number,
  minIntervalMs: number,
): boolean {
  return lastEmissionMs === 0 || nowMs - lastEmissionMs >= minIntervalMs;
}
