import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import { safeReloadPendingOta, shouldApplyDownloadedOta } from "./otaAutoApply";
import { pushOtaLog } from "./otaLaunchLog";

const OTA_LAUNCH_TIMEOUT_MS = 12_000;

export type LaunchOtaOutcome = "reloaded" | "idle";

async function withLaunchTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${OTA_LAUNCH_TIMEOUT_MS}ms`)),
          OTA_LAUNCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkDetail(check: Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>): string {
  const roll = (check as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded;
  return JSON.stringify({
    isAvailable: check.isAvailable,
    isRollBackToEmbedded: roll === true,
    reason: (check as { reason?: string }).reason ?? null,
  });
}

/**
 * Launch-time OTA: apply pending download → check → fetch → reload.
 * Logs every step + exact errors. Never uses React error-boundary reset.
 */
export async function launchOtaCheckFetchReload(): Promise<LaunchOtaOutcome> {
  if (__DEV__ || !Updates.isEnabled) {
    pushOtaLog("checkForUpdateAsync", false, "skipped: dev or Updates.isEnabled=false");
    return "idle";
  }

  try {
    if (shouldApplyDownloadedOta()) {
      if (await safeReloadPendingOta("launch-pending-before-check")) return "reloaded";
    }

    pushOtaLog("checkForUpdateAsync", true, "calling…");
    const check = await withLaunchTimeout("checkForUpdateAsync", Updates.checkForUpdateAsync());
    pushOtaLog("checkForUpdateAsync", true, checkDetail(check));

    const rollBack = (check as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded;
    if (rollBack || check.isAvailable) {
      try {
        pushOtaLog("fetchUpdateAsync", true, "calling…");
        await withLaunchTimeout("fetchUpdateAsync", Updates.fetchUpdateAsync());
        pushOtaLog("fetchUpdateAsync", true, "success");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushOtaLog("fetchUpdateAsync", false, msg);
        throw e;
      }

      if (await safeReloadPendingOta("launch-after-fetch")) return "reloaded";
    }

    const pending = !!latestContext?.isUpdatePending || shouldApplyDownloadedOta();
    if (pending) {
      if (await safeReloadPendingOta("launch-pending-after-check")) return "reloaded";
    }

    return "idle";
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    pushOtaLog("checkForUpdateAsync", false, msg);

    if (shouldApplyDownloadedOta()) {
      if (await safeReloadPendingOta("launch-pending-after-error")) return "reloaded";
    }

    return "idle";
  }
}
