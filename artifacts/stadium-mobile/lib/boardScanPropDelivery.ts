/**
 * Pure helpers for Coach board-scan prop delivery.
 * Kept free of api.ts so node:test can cover the 7-leg → 3 F5 latch without
 * loading the full scanner module graph.
 */

/** ~50% of an N-leg ticket is reserved for player props (matches preview staging). */
export function boardScanPropSlotCount(targetLegs: number): number {
  if (targetLegs < 3) return 0;
  return Math.max(1, Math.round(targetLegs * 0.5));
}

/** Game-line preview capacity while prop slots are still reserved. */
export function boardScanNonPropPreviewCap(targetLegs: number): number {
  return Math.max(0, targetLegs - boardScanPropSlotCount(targetLegs));
}

/**
 * Preview-only gate: while game lines are scoring and no props have landed yet,
 * hold reserved prop slots open so we do not paint F5-only previews as the ticket.
 *
 * Never set this on a final result — that wiped cleared game lines to a 0-leg
 * "instant empty" ticket when prop scoring threw or timed out (#469 regression).
 * Final prop shortfalls use `propPhaseIncomplete` + honest notes instead.
 */
export function shouldKeepAwaitingPropSlots(opts: {
  preview?: boolean;
  propsOnly?: boolean;
  targetLegs: number;
  propCount: number;
  propPhaseIncomplete?: boolean;
}): boolean {
  if (opts.propsOnly || opts.targetLegs < 3) return false;
  if (!opts.preview) return false;
  const propSlots = boardScanPropSlotCount(opts.targetLegs);
  return opts.propCount < propSlots && opts.propCount === 0;
}
