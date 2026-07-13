import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

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
 * Launch-time OTA: check → fetch → reload. Logs every step + exact errors.
 * Never uses React error-boundary reset (that keeps stale in-memory JS).
 */
export async function launchOtaCheckFetchReload(): Promise<LaunchOtaOutcome> {
  if (__DEV__ || !Updates.isEnabled) {
    pushOtaLog("checkForUpdateAsync", false, "skipped: dev or Updates.isEnabled=false");
    return "idle";
  }

  try {
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

      try {
        pushOtaLog("reloadAsync", true, "calling…");
        await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
        pushOtaLog("reloadAsync", true, "invoked");
        return "reloaded";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushOtaLog("reloadAsync", false, msg);
        throw e;
      }
    }

    const pending = !!latestContext?.isUpdatePending;
    if (pending) {
      try {
        pushOtaLog("reloadAsync", true, "pending update — calling…");
        await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
        pushOtaLog("reloadAsync", true, "invoked (pending)");
        return "reloaded";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushOtaLog("reloadAsync", false, msg);
        throw e;
      }
    }

    return "idle";
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    pushOtaLog("checkForUpdateAsync", false, msg);
    return "idle";
  }
}
