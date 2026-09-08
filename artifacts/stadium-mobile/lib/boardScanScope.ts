// Board-scan scope — dynamic prop-sim caps (500–1000) instead of fixed 70/120.

export const BOARD_PROP_SIM_CAP_MIN = 500;
export const BOARD_PROP_SIM_CAP_MAX = 1000;

export type BoardScanScopeOpts = {
  longshotAsk?: boolean;
};

/** Max prop rows to Monte-Carlo after quick prescore ranking. */
export function boardScanMaxPropsToSim(
  targetLegs: number,
  poolSize: number,
  opts: BoardScanScopeOpts = {},
): number {
  const longshot = opts.longshotAsk || targetLegs >= 15;
  const floor =
    targetLegs >= 15 ? BOARD_PROP_SIM_CAP_MAX : longshot ? 700 : BOARD_PROP_SIM_CAP_MIN;
  const scaled = Math.max(targetLegs * (longshot ? 50 : 35), floor);
  const cap = Math.min(scaled, BOARD_PROP_SIM_CAP_MAX);
  return Math.min(poolSize, cap);
}

/** Per-batch prop sim timeout (ms). */
export function boardScanPropSimBatchTimeoutMs(): number {
  return 12_000;
}

/** Max odds games to expand for posted props during a timed scan. */
export function boardScanMaxPropGames(targetLegs: number, gameCount: number): number {
  if (targetLegs >= 15) return gameCount;
  if (targetLegs >= 9) return gameCount;
  return gameCount;
}
