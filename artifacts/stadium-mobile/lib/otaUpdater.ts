import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard } from "react-native";

import { isOtaReloadBlocked, subscribeOtaReloadUnblocked } from "@/lib/otaBlock";
import {
  emptyFailedLaunchRecord,
  isUpdatePreviouslyFailed,
  noteReloadTarget,
  OTA_FAILED_LAUNCH_KEY,
  readFailedLaunchRecord,
  reconcileLaunch,
  updateFailedLaunchRecord,
  writeFailedLaunchRecord,
  type OtaFailedLaunchRecord,
  type OtaFailedLaunchStorage,
} from "@/lib/otaFailedLaunch";
import { pushOtaLog } from "@/lib/otaLaunchLog";
import { reportOtaRecoveryState } from "@/lib/otaRecoveryState";
import { resolveReloadTargetId } from "@/lib/otaReloadGuard";
import {
  prefetchOtaUpdate,
  reloadPendingOtaUpdate,
  resetOtaUpdaterSessionGuardForTests,
  type OtaPrefetchOutcome,
  type OtaUpdaterOptions,
} from "@/lib/otaUpdaterCore";

export type { OtaPrefetchOutcome, OtaUpdateClient, OtaFetchResult } from "@/lib/otaUpdaterCore";
export { prefetchOtaUpdate, resetOtaUpdaterSessionGuardForTests };

const FOREGROUND_DEBOUNCE_MS = 45_000;
const LAUNCH_DELAY_MS = 400;
const SAFE_RELOAD_DELAY_MS = 1_000;
/** Backstop retry while an update is pending but every reload attempt is blocked. */
const PENDING_RETRY_MS = 20_000;
/** A hung check/fetch must not stall the session — expo-updates has no internal timeout. */
const OTA_NETWORK_TIMEOUT_MS = 15_000;

const failedLaunchStorage: OtaFailedLaunchStorage = {
  read: () => AsyncStorage.getItem(OTA_FAILED_LAUNCH_KEY),
  write: (raw) => AsyncStorage.setItem(OTA_FAILED_LAUNCH_KEY, raw),
};

/** Synchronous mirror of the persisted ledger so the pure core can consult it. */
let failedLaunchRecord: OtaFailedLaunchRecord = emptyFailedLaunchRecord();
let failedLaunchReconciled = false;

function runningUpdateId(): string | null {
  const id = Updates.updateId;
  return id ? String(id) : null;
}

function downloadedUpdateId(): string | null {
  const downloaded = latestContext?.downloadedManifest as { id?: string } | null | undefined;
  const id = downloaded?.id;
  return id ? String(id) : null;
}

function rollbackState(): string {
  const parts: string[] = [];
  if (Updates.isEmbeddedLaunch) parts.push("embedded");
  if (Updates.isEmergencyLaunch) {
    parts.push(`emergency(${Updates.emergencyLaunchReason ?? "no reason"})`);
  }
  const commitTime = latestContext?.rollback?.commitTime;
  if (commitTime) parts.push(`rollbackDirective@${String(commitTime)}`);
  return parts.length ? parts.join(" · ") : "none";
}

/**
 * Reconcile the previous launch once per session: if we asked to restart into a
 * target and came back running something else, that target failed to launch.
 */
async function reconcileFailedLaunches(): Promise<void> {
  if (failedLaunchReconciled) return;
  failedLaunchReconciled = true;

  const running = runningUpdateId();
  const result = reconcileLaunch(await readFailedLaunchRecord(failedLaunchStorage), running);
  failedLaunchRecord = result.record;
  await writeFailedLaunchRecord(failedLaunchStorage, result.record);

  if (result.observed === "failed") {
    pushOtaLog(
      "reloadAsync",
      false,
      `previous launch of ${result.failedTargetId} failed (count=${result.failedCount}); running ${running ?? "embedded"}`,
    );
  } else if (result.observed === "launched") {
    pushOtaLog("reloadAsync", true, `confirmed running target ${running}`);
  }

  reportOtaRecoveryState({
    runningUpdateId: running ?? "embedded",
    rollbackState: rollbackState(),
    failedLaunchCount: result.failedCount ?? 0,
    updatePreviouslyFailed: !!result.failedTargetId,
  });
}

async function noteReloadTargetPersisted(targetId: string): Promise<void> {
  failedLaunchRecord = noteReloadTarget(failedLaunchRecord, targetId);
  await updateFailedLaunchRecord(failedLaunchStorage, (record) =>
    noteReloadTarget(record, targetId),
  );
}

function withOtaTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${OTA_NETWORK_TIMEOUT_MS}ms`)),
        OTA_NETWORK_TIMEOUT_MS,
      );
    }),
  ]);
}

/** expo-updates with bounded check/fetch so a hung request cannot stall recovery. */
const timeoutClient = {
  checkForUpdateAsync: () =>
    withOtaTimeout("checkForUpdateAsync", Updates.checkForUpdateAsync()),
  fetchUpdateAsync: () => withOtaTimeout("fetchUpdateAsync", Updates.fetchUpdateAsync()),
  reloadAsync: (opts?: { reloadScreenOptions?: { fade?: boolean } }) =>
    Updates.reloadAsync(opts),
};

function updaterOptions(): OtaUpdaterOptions {
  return {
    isReloadBlocked: isOtaReloadBlocked,
    log: pushOtaLog,
    reloadUpdateKey: runningUpdateId() ?? "pending",
    downloadedUpdateId,
    isTargetPreviouslyFailed: (targetId) =>
      isUpdatePreviouslyFailed(failedLaunchRecord, targetId),
    onReloadTarget: noteReloadTargetPersisted,
    report: reportOtaRecoveryState,
  };
}

function otaDisabledReason(): string | null {
  if (__DEV__) return "skipped: __DEV__";
  if (!Updates.isEnabled) return "skipped: Updates.isEnabled=false";
  return null;
}

/**
 * Prefetch (and optionally apply) a production OTA.
 * Reload guards must not skip check/fetch — they only delay reload.
 */
export async function prefetchAndMaybeApplyOta(
  applyWhenReady = false,
): Promise<OtaPrefetchOutcome> {
  const disabled = otaDisabledReason();
  if (disabled) {
    // Never return silently: an empty log must mean "never ran", not "disabled".
    pushOtaLog("checkForUpdateAsync", false, disabled);
    reportOtaRecoveryState({ checkResult: disabled, lastError: disabled });
    return "none";
  }
  await reconcileFailedLaunches();
  return prefetchOtaUpdate(
    timeoutClient,
    () => !!latestContext?.isUpdatePending,
    applyWhenReady,
    updaterOptions(),
  );
}

/** Background fetch only — never auto-reloads. Banner / safe-reload applies. */
export async function prefetchOtaInBackground(): Promise<OtaPrefetchOutcome> {
  return prefetchAndMaybeApplyOta(false);
}

/** @deprecated Prefer prefetchAndMaybeApplyOta / OtaUpdateBanner. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  return (await prefetchAndMaybeApplyOta(true)) === "applied";
}

/**
 * Production updater: check/fetch on launch and meaningful foregrounding.
 * Reloads once when safe (no keyboard, no Coach/Fantasy block, loop guard ok).
 */
export function useOtaUpdater(enabled: boolean) {
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const reloadAttempted = useRef(false);
  const keyboardVisible = useRef(false);
  const updatePending = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReloadTimer = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = null;
  }, []);

  const hasPending = useCallback(
    () => updatePending.current || !!latestContext?.isUpdatePending,
    [],
  );

  /**
   * Apply a pending update without re-checking the network. Re-checking here is
   * what previously let a flaky request discard a bundle already on disk.
   */
  const reloadWhenSafe = useCallback(() => {
    if (reloadAttempted.current) return;
    if (!hasPending()) return;
    if (keyboardVisible.current) {
      pushOtaLog("reloadAsync", false, "blocked: keyboard visible");
      reportOtaRecoveryState({ reloadBlocked: true, reloadBlockedReason: "keyboard visible" });
      return;
    }

    clearReloadTimer();
    reloadTimer.current = setTimeout(() => {
      if (reloadAttempted.current || !hasPending()) return;
      if (keyboardVisible.current) {
        pushOtaLog("reloadAsync", false, "blocked: keyboard visible");
        reportOtaRecoveryState({ reloadBlocked: true, reloadBlockedReason: "keyboard visible" });
        return;
      }

      const targetId = resolveReloadTargetId({
        downloadedUpdateId: downloadedUpdateId(),
        runningUpdateId: runningUpdateId(),
      });
      void reloadPendingOtaUpdate(timeoutClient, targetId, updaterOptions()).then((outcome) => {
        if (outcome === "applied") reloadAttempted.current = true;
      });
    }, SAFE_RELOAD_DELAY_MS);
  }, [clearReloadTimer, hasPending]);

  const prefetch = useCallback(
    async (force = false) => {
      if (!enabled || otaDisabledReason() || inFlight.current) return;

      const now = Date.now();
      if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
      lastCheckAt.current = now;

      inFlight.current = true;
      try {
        const outcome = await prefetchAndMaybeApplyOta(false);
        if (outcome === "pending") {
          updatePending.current = true;
          reloadWhenSafe();
        }
      } finally {
        inFlight.current = false;
      }
    },
    [enabled, reloadWhenSafe],
  );

  useEffect(() => {
    if (!enabled) return;

    const launchTimer = setTimeout(() => void prefetch(true), LAUNCH_DELAY_MS);
    let backgroundAt = 0;

    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") backgroundAt = Date.now();
      if (state === "active") {
        if (hasPending()) reloadWhenSafe();
        if (backgroundAt && Date.now() - backgroundAt >= FOREGROUND_DEBOUNCE_MS) {
          void prefetch(false);
        }
      }
    });

    const keyboardShow = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisible.current = true;
      clearReloadTimer();
    });
    const keyboardHide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisible.current = false;
      reloadWhenSafe();
    });

    // Coach/Fantasy critical work finishing is the third retry trigger.
    const unblocked = subscribeOtaReloadUnblocked(() => reloadWhenSafe());

    // Backstop: a pending update must never be stranded just because no event
    // fires while it is blocked.
    const pendingRetry = setInterval(() => {
      if (reloadAttempted.current) return;
      if (hasPending()) reloadWhenSafe();
    }, PENDING_RETRY_MS);

    return () => {
      clearTimeout(launchTimer);
      clearInterval(pendingRetry);
      appState.remove();
      keyboardShow.remove();
      keyboardHide.remove();
      unblocked();
      clearReloadTimer();
    };
  }, [clearReloadTimer, enabled, hasPending, prefetch, reloadWhenSafe]);

  return false;
}
