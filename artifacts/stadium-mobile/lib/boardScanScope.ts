// Board-scan scope — pre-rank cap so deep prop MC cannot exhaust 5k+ candidates.

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

/** How many prop-sim sub-batches may run concurrently inside one wave. */
export function boardPropSimFetchConcurrency(): number {
  return 2;
}
