// Board-scan scope — pre-rank cap so deep prop MC cannot exhaust thousands of
// candidates and strand Coach on "finishing your ticket" forever.
// Does not change qualification thresholds — only how many rows reach deep sim.

export const BOARD_PROP_SIM_CAP_MIN = 500;
export const BOARD_PROP_SIM_CAP_MAX = 1000;

/** Max prop rows to deep-simulate after prescore ranking (quality gates unchanged). */
export function boardScanMaxPropsToSim(targetLegs: number, poolSize: number): number {
  const deepAsk = targetLegs >= 15;
  const floor = deepAsk ? 700 : BOARD_PROP_SIM_CAP_MIN;
  const scaled = Math.max(targetLegs * (deepAsk ? 45 : 35), floor);
  const cap = Math.min(scaled, BOARD_PROP_SIM_CAP_MAX);
  return Math.min(poolSize, cap);
}

/** Per-batch deep prop-sim wall timeout (ms). */
export function boardScanPropSimBatchTimeoutMs(): number {
  return 45_000;
}

/**
 * Hard wall for the entire prop-sim phase.
 * Guarantees buildTopLegsFromFullBoardScan falls through to boardExhausted
 * final even when props never qualify — Coach must not sit at 84% forever.
 *
 * When the prop pool is prefetched, this phase overlaps game-line sims so the
 * absolute Coach budget cannot starve player props (7-leg → 3 F5 game lines).
 */
export function boardScanPropPhaseDeadlineMs(targetLegs: number): number {
  if (targetLegs >= 15) return 75_000;
  if (targetLegs >= 9) return 60_000;
  if (targetLegs >= 6) return 45_000;
  return 35_000;
}

/**
 * Cap game-line sims when props run in parallel, so the wall clock still
 * leaves room for prop MC inside the Coach absolute delivery budget.
 */
export function boardScanGamePhaseBudgetMs(targetLegs: number): number {
  if (targetLegs >= 9) return 32_000;
  if (targetLegs >= 6) return 28_000;
  return 24_000;
}

/** Prefetched pools should overlap prop scoring with game lines. */
export function shouldOverlapPropPhaseWithGames(
  skipPropPoolExpand: boolean | undefined,
  propPoolSize: number,
  propsOnly?: boolean,
): boolean {
  return !!skipPropPoolExpand && propPoolSize > 0 && !propsOnly;
}
