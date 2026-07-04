/** Block OTA reload while a critical in-flight operation (e.g. Coach build) runs. */
let blockCount = 0;

export function blockOtaReload(): () => void {
  blockCount++;
  return () => {
    blockCount = Math.max(0, blockCount - 1);
  };
}

export function isOtaReloadBlocked(): boolean {
  return blockCount > 0;
}
