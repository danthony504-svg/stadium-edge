/**
 * LEGACY SHIM — production OTA is owned exclusively by `lib/ota/OtaController`.
 *
 * This module no longer checks, fetches, or reloads. It only re-exports pure
 * helpers that unit tests still exercise, plus inert stubs so accidental
 * imports cannot resurrect the old updater.
 */

import { useEffect } from "react";

import { pushOtaLog } from "@/lib/otaLaunchLog";
import {
  prefetchOtaUpdate,
  resetOtaUpdaterSessionGuardForTests,
  type OtaPrefetchOutcome,
} from "@/lib/otaUpdaterCore";

export type { OtaPrefetchOutcome, OtaUpdateClient, OtaFetchResult } from "@/lib/otaUpdaterCore";
export { prefetchOtaUpdate, resetOtaUpdaterSessionGuardForTests };

/** @deprecated LEGACY no-op — use lib/ota/OtaController */
export async function prefetchAndMaybeApplyOta(
  _applyWhenReady = false,
): Promise<OtaPrefetchOutcome> {
  pushOtaLog(
    "checkForUpdateAsync",
    false,
    "legacy prefetchAndMaybeApplyOta disabled — use lib/ota/OtaController",
  );
  return "none";
}

/** @deprecated LEGACY no-op — use lib/ota/OtaController */
export async function prefetchOtaInBackground(): Promise<OtaPrefetchOutcome> {
  return "none";
}

/** @deprecated LEGACY no-op — use lib/ota/OtaController.restart() */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  return false;
}

/**
 * @deprecated LEGACY no-op.
 * Production mounts `useOtaController` via `components/OtaRuntime.tsx`.
 */
export function useOtaUpdater(_enabled: boolean) {
  useEffect(() => {
    console.warn(
      "[ota] useOtaUpdater is disabled. Production OTA uses lib/ota/OtaController.",
    );
  }, []);
  return false;
}
