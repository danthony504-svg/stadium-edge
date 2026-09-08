// Board-scan scope limits — keep 15-leg longshots inside the 30s request budget.

/** Max prop rows to Monte-Carlo simulate per scan (ranked prescore order). */
export function boardScanMaxPropsToSim(targetLegs: number, poolSize: number): number {
  const multiplier = targetLegs >= 15 ? 8 : targetLegs >= 9 ? 10 : 14;
  const cap = Math.max(targetLegs * multiplier, 40);
  return Math.min(poolSize, cap);
}

/** Per-batch prop sim timeout — quick tier fits inside REQUEST_TIMEOUT_MS (12s). */
export function boardScanPropSimBatchTimeoutMs(): number {
  return 12_000;
}

/** Max odds games to expand for posted props during a timed scan. */
export function boardScanMaxPropGames(targetLegs: number, gameCount: number): number {
  if (targetLegs >= 15) return Math.min(gameCount, 28);
  if (targetLegs >= 9) return Math.min(gameCount, 40);
  return gameCount;
}

/** Wall-clock budget for board scan inside the 30s request deadline. */
export function boardScanDeadlineMs(targetLegs: number): number {
  if (targetLegs >= 15) return 22_000;
  if (targetLegs >= 9) return 24_000;
  return 26_000;
}
