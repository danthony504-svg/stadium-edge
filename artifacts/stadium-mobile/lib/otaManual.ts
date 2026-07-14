import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import { withOtaTimeout } from "./otaDebug";
import { pushOtaLog } from "./otaLaunchLog";

export type OtaCheckOutcome = {
  available: boolean;
  isRollBackToEmbedded: boolean;
  reason: string;
};

export type OtaDownloadOutcome = {
  downloaded: boolean;
  isUpdatePending: boolean;
  reason: string;
};

export type OtaRestartOutcome = {
  restarted: boolean;
  reason: string;
};

function updatesDisabled(): boolean {
  return __DEV__ || !Updates.isEnabled;
}

export function readOtaPendingState(): {
  isUpdatePending: boolean;
  isDownloading: boolean;
} {
  return {
    isUpdatePending: !!latestContext?.isUpdatePending,
    isDownloading: !!latestContext?.isDownloading,
  };
}

/** Step 1 — check only; never downloads or reloads. */
export async function manualCheckForUpdate(): Promise<OtaCheckOutcome> {
  if (updatesDisabled()) {
    const reason = "Updates disabled (dev build or expo-updates off)";
    pushOtaLog("checkForUpdateAsync", false, `manual: ${reason}`);
    return { available: false, isRollBackToEmbedded: false, reason };
  }

  try {
    pushOtaLog("checkForUpdateAsync", true, "manual: check…");
    const check = await withOtaTimeout("checkForUpdateAsync", Updates.checkForUpdateAsync());
    const rollBack = (check as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded === true;
    const detail = JSON.stringify({
      isAvailable: check.isAvailable,
      isRollBackToEmbedded: rollBack,
      reason: (check as { reason?: string }).reason ?? null,
    });
    pushOtaLog("checkForUpdateAsync", true, detail);

    if (rollBack) {
      return {
        available: true,
        isRollBackToEmbedded: true,
        reason: "Server requests rollback to embedded bundle",
      };
    }
    if (check.isAvailable) {
      return { available: true, isRollBackToEmbedded: false, reason: "Update available" };
    }
    return {
      available: false,
      isRollBackToEmbedded: false,
      reason: "Already on the latest update for this runtime and channel",
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    pushOtaLog("checkForUpdateAsync", false, reason);
    return { available: false, isRollBackToEmbedded: false, reason };
  }
}

/** Step 2 — download only; never reloads. */
export async function manualDownloadUpdate(): Promise<OtaDownloadOutcome> {
  if (updatesDisabled()) {
    const reason = "Updates disabled (dev build or expo-updates off)";
    pushOtaLog("fetchUpdateAsync", false, `manual: ${reason}`);
    return { downloaded: false, isUpdatePending: false, reason };
  }

  try {
    pushOtaLog("fetchUpdateAsync", true, "manual: download…");
    const result = await withOtaTimeout("fetchUpdateAsync", Updates.fetchUpdateAsync());
    const pending = !!latestContext?.isUpdatePending;
    const detail = JSON.stringify({
      isNew: (result as { isNew?: boolean }).isNew ?? null,
      isUpdatePending: pending,
    });
    pushOtaLog("fetchUpdateAsync", true, detail);

    if (pending) {
      return {
        downloaded: true,
        isUpdatePending: true,
        reason: "Update downloaded — restart to apply",
      };
    }
    return {
      downloaded: false,
      isUpdatePending: false,
      reason: "Nothing new to download (check first, or wait for background ON_LOAD fetch)",
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    pushOtaLog("fetchUpdateAsync", false, reason);
    return { downloaded: false, isUpdatePending: false, reason };
  }
}

/**
 * Step 3 — reload only after user taps Restart.
 * reloadAsync is never called automatically during boot or background fetch.
 */
export async function manualRestartToApplyUpdate(): Promise<OtaRestartOutcome> {
  if (updatesDisabled()) {
    const reason = "Updates disabled (dev build or expo-updates off)";
    pushOtaLog("reloadAsync", false, `manual: ${reason}`);
    return { restarted: false, reason };
  }

  const { isUpdatePending } = readOtaPendingState();
  if (!isUpdatePending) {
    const reason = "No downloaded update pending — download first";
    pushOtaLog("reloadAsync", false, `manual: ${reason}`);
    return { restarted: false, reason };
  }

  try {
    pushOtaLog("reloadAsync", true, "manual: user tapped Restart");
    await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
    pushOtaLog("reloadAsync", true, "invoked");
    return { restarted: true, reason: "Restarting…" };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    pushOtaLog("reloadAsync", false, reason);
    return { restarted: false, reason };
  }
}
