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

/** Per-batch deep prop-sim wall timeout (ms).
 * Must stay well under the prop-phase deadline so one hung batch cannot
 * consume the whole window (8-leg → only ~1 batch → 4-of-8 shortfall).
 */
export function boardScanPropSimBatchTimeoutMs(): number {
  return 18_000;
}

/**
 * Hard wall for the entire prop-sim phase.
 * Guarantees buildTopLegsFromFullBoardScan falls through to boardExhausted
 * final even when props never qualify — Coach must not sit at 84% forever.
 *
 * When the prop pool is prefetched, this phase overlaps game-line sims so the
 * absolute Coach budget cannot starve player props (7-leg → 3 F5 game lines).
 *
 * Football mix asks get a dedicated longer window. Game lines may overlap the
 * finishable ≤72/96 skill wave under a prop-priority simulate limiter; the
 * prop phase is never cancelled when games finish.
 */
export function boardScanPropPhaseDeadlineMs(
  targetLegs: number,
  opts?: { exhaustPropBoard?: boolean; requirePropMix?: boolean },
): number {
  // HR full-board exhaust needs more wall time so matchup-strong hitters
  // beyond the first EV-sorted wave still get MC before Coach finalizes.
  if (opts?.exhaustPropBoard) {
    if (targetLegs >= 9) return 90_000;
    if (targetLegs >= 6) return 75_000;
    return 55_000;
  }
  // Football mix: finishable skill-prop wave (≤96 rows). Overlaps game lines
  // with prop-priority shared simulate concurrency (not the old 360-row starve).
  if (opts?.requirePropMix) {
    if (targetLegs >= 15) return 85_000;
    if (targetLegs >= 9) return 75_000;
    if (targetLegs >= 6) return 60_000;
    return 45_000;
  }
  // Deep fixed-leg tickets need multiple prop batches on busy MLB/NFL boards.
  if (targetLegs >= 15) return 90_000;
  if (targetLegs >= 9) return 80_000;
  if (targetLegs >= 8) return 75_000;
  if (targetLegs >= 6) return 65_000;
  return 40_000;
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

/**
 * Football mix game-line sim budget (soft ceiling). When overlapping the prop
 * phase, wall is measured from the shared scoring start and further capped by
 * the absolute budget minus finalization reserve.
 */
export function boardScanMixGamePhaseBudgetMs(targetLegs: number): number {
  if (targetLegs >= 9) return 28_000;
  if (targetLegs >= 6) return 24_000;
  return 20_000;
}

/**
 * Football mix: overlap prop deep-sim/enrich with game-line sims when the
 * finishable skill set is in play (≤72 for 9 legs). Props-only stays prop-only.
 */
export function shouldOverlapFootballMixSims(
  requirePropMix: boolean | undefined,
  propsOnly: boolean | undefined,
  propPoolSize: number,
): boolean {
  return !!requirePropMix && !propsOnly && propPoolSize > 0;
}

/**
 * Game-phase wall for overlapped football mix: at least the mix soft ceiling
 * (and the historical 36s floor), but never past absolute − finalization reserve.
 */
export function boardScanFootballMixOverlapGameBudgetMs(
  targetLegs: number,
  absoluteBudgetMs: number,
  finalizationReserveMs: number,
): number {
  const mixFloor = Math.max(boardScanMixGamePhaseBudgetMs(targetLegs), 36_000);
  const scoringCap = Math.max(0, absoluteBudgetMs - finalizationReserveMs);
  return Math.min(mixFloor, scoringCap);
}

/**
 * Football mix: deep-sim a finishable skill-prop set (yards + TD quotas).
 * Caps of 200–360 never finished under the Coach wall → 0 props + seat hold.
 * ~80 rows (≤96) completes in a few batches so skill props can land.
 */
export function boardScanMaxPropsToSimForMix(
  targetLegs: number,
  poolSize: number,
): number {
  const scaled = Math.max(targetLegs * 8, 56);
  const cap = Math.min(scaled, 96);
  return Math.min(poolSize, cap);
}

/** Prefetched pools should overlap prop scoring with game lines. */
export function shouldOverlapPropPhaseWithGames(
  skipPropPoolExpand: boolean | undefined,
  propPoolSize: number,
  propsOnly?: boolean,
): boolean {
  return !!skipPropPoolExpand && propPoolSize > 0 && !propsOnly;
}
