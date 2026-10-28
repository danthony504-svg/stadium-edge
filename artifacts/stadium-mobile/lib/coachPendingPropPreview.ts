/** Keep a provisional game-only buffer below the UI's early-completion latch. */
export function pendingPropPreview<T extends { isProp?: boolean }>(picks: readonly T[], target: number, awaitingProps: boolean, mixedRequest: boolean): T[] {
  if (!mixedRequest || !awaitingProps || picks.some(p => p.isProp)) return [...picks];
  return picks.slice(0, Math.max(0, target - 1));
}
