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
 * Final game-line-only tickets must keep awaitingPropSlots when prop scoring
 * was cut short — otherwise reserved F5-only previews (2 of 5 / 3 of 7) publish
 * as "every market scanned".
 */
export function shouldKeepAwaitingPropSlots(opts: {
  preview?: boolean;
  propsOnly?: boolean;
  targetLegs: number;
  propCount: number;
  propPhaseIncomplete?: boolean;
}): boolean {
  if (opts.propsOnly || opts.targetLegs < 3) return false;
  if (opts.preview) {
    const propSlots = boardScanPropSlotCount(opts.targetLegs);
    return opts.propCount < propSlots && opts.propCount === 0;
  }
  return !!opts.propPhaseIncomplete && opts.propCount === 0;
}
