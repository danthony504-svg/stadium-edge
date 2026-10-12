/**
 * LEGACY — disabled.
 * Auto-reload helpers are incompatible with the new OtaController
 * (no automatic reloadAsync). Kept as inert stubs so old imports resolve.
 */

import type { OtaReloadGuard } from "./otaReloadGuard";
import { shouldAllowAutoReload } from "./otaReloadGuard";

export type { OtaReloadGuard };
export { shouldAllowAutoReload };

/** @deprecated Always false — auto apply removed. */
export function isUpdatePendingNow(): boolean {
  return false;
}

/** @deprecated No-op — use OtaController.restart() from the Restart button only. */
export async function safeReloadPendingOta(_reason: string): Promise<boolean> {
  console.warn(
    "[ota] safeReloadPendingOta disabled — automatic reloadAsync is forbidden",
  );
  return false;
}
