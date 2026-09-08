/** Block OTA reload while a critical in-flight operation (e.g. Coach build) runs. */
let blockCount = 0;
const unblockListeners = new Set<() => void>();

export function blockOtaReload(): () => void {
  blockCount++;
  return () => {
    blockCount = Math.max(0, blockCount - 1);
    if (blockCount === 0) {
      for (const fn of unblockListeners) fn();
    }
  };
}

export function isOtaReloadBlocked(): boolean {
  return blockCount > 0;
}

/**
 * Notify when the last critical operation finishes, so a pending OTA that was
 * only delayed by Coach/Fantasy work can retry immediately instead of waiting
 * for the next foreground.
 */
export function subscribeOtaReloadUnblocked(listener: () => void): () => void {
  unblockListeners.add(listener);
  return () => unblockListeners.delete(listener);
}
