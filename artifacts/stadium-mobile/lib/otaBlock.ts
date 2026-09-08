/** Block OTA reload while a critical in-flight operation (e.g. Coach build) runs. */
let blockCount = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function blockOtaReload(): () => void {
  blockCount++;
  notify();
  return () => {
    blockCount = Math.max(0, blockCount - 1);
    notify();
  };
}

export function isOtaReloadBlocked(): boolean {
  return blockCount > 0;
}

/** Fires whenever the block count changes (including unblock → 0). */
export function subscribeOtaReloadBlock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetOtaReloadBlockForTests(): void {
  blockCount = 0;
  listeners.clear();
}
