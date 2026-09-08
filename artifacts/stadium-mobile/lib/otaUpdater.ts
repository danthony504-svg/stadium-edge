import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard } from "react-native";

import { isOtaReloadBlocked, subscribeOtaReloadBlock } from "@/lib/otaBlock";
import { pushOtaLog } from "@/lib/otaLaunchLog";
import { patchOtaRecoveryStatus } from "@/lib/otaRecoveryStatus";
import {
  applyPendingOtaReloadDetailed,
  prefetchOtaUpdate,
  prefetchOtaUpdateDetailed,
  reloadGuardRetryDelayMs,
  resetOtaUpdaterSessionGuardForTests,
  type OtaPrefetchOutcome,
  type OtaPrefetchReport,
} from "@/lib/otaUpdaterCore";

export type { OtaPrefetchOutcome, OtaUpdateClient, OtaFetchResult } from "@/lib/otaUpdaterCore";
export { prefetchOtaUpdate, resetOtaUpdaterSessionGuardForTests };

const FOREGROUND_DEBOUNCE_MS = 45_000;
const LAUNCH_DELAY_MS = 400;
const SAFE_RELOAD_DELAY_MS = 1_000;
const GUARD_RETRY_CAP_MS = 60_000;

function runningUpdateId(): string {
  return String(Updates.updateId ?? (Updates.isEmbeddedLaunch ? "embedded" : "—"));
}

function contextDownloadedId(): string | null {
  const downloaded = latestContext?.downloadedManifest as { id?: string } | null | undefined;
  return downloaded?.id ?? null;
}

/** Loop-guard / reload key = pending download id, never the currently running bundle id. */
function pendingReloadKey(availableId?: string | null): string {
  return availableId || contextDownloadedId() || "pending-download";
}

function publishStatus(report: OtaPrefetchReport, reloadBlocked: boolean): void {
  patchOtaRecoveryStatus({
    runningUpdateId: runningUpdateId(),
    availableUpdateId: report.availableUpdateId ?? contextDownloadedId() ?? "—",
    fetchResult: report.fetchResult ?? "—",
    pending: report.pending || !!latestContext?.isUpdatePending,
    reloadBlocked,
    lastOtaError: report.lastError ?? "—",
    checkReason: report.checkReason ?? "—",
    isEmergencyLaunch: !!Updates.isEmergencyLaunch,
    rollbackCommitTime: String(
      (latestContext as { rollback?: { commitTime?: string } } | null)?.rollback?.commitTime ?? "—",
    ),
  });
}

/**
 * Prefetch (and optionally apply) a production OTA.
 * Reload guards must not skip check/fetch — they only delay reload.
 */
export async function prefetchAndMaybeApplyOta(
  applyWhenReady = false,
): Promise<OtaPrefetchOutcome> {
  if (__DEV__ || !Updates.isEnabled) return "none";
  const report = await prefetchOtaUpdateDetailed(
    Updates,
    () => !!latestContext?.isUpdatePending,
    applyWhenReady,
    {
      isReloadBlocked: isOtaReloadBlocked,
      log: pushOtaLog,
      reloadUpdateKey: pendingReloadKey(),
    },
  );
  publishStatus(report, report.reloadBlocked || isOtaReloadBlocked());
  return report.outcome;
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
 * Reloads when safe; retries when AppState active, keyboard hides, or Coach unblock.
 * Loop guard is keyed by pending download id and schedules a retry — it cannot
 * permanently strand a successfully downloaded update.
 */
export function useOtaUpdater(enabled: boolean) {
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const reloadAttempted = useRef(false);
  const keyboardVisible = useRef(false);
  const updatePending = useRef(false);
  const availableIdRef = useRef<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadWhenSafeRef = useRef<() => void>(() => {});

  const clearReloadTimer = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = null;
  }, []);

  const clearGuardRetryTimer = useCallback(() => {
    if (guardRetryTimer.current) clearTimeout(guardRetryTimer.current);
    guardRetryTimer.current = null;
  }, []);

  const hasPending = useCallback(
    () => updatePending.current || !!latestContext?.isUpdatePending,
    [],
  );

  const scheduleGuardRetry = useCallback(
    (updateKey: string) => {
      clearGuardRetryTimer();
      const delay = Math.min(Math.max(reloadGuardRetryDelayMs(updateKey), 1_000), GUARD_RETRY_CAP_MS);
      guardRetryTimer.current = setTimeout(() => {
        guardRetryTimer.current = null;
        reloadAttempted.current = false;
        reloadWhenSafeRef.current();
      }, delay);
    },
    [clearGuardRetryTimer],
  );

  const applyPendingReload = useCallback(async () => {
    if (reloadAttempted.current) return;
    if (!hasPending()) return;

    if (keyboardVisible.current) {
      pushOtaLog("reloadAsync", false, "blocked: keyboard visible");
      patchOtaRecoveryStatus({
        reloadBlocked: true,
        pending: true,
        lastOtaError: "blocked: keyboard visible",
        runningUpdateId: runningUpdateId(),
      });
      return;
    }
    if (isOtaReloadBlocked()) {
      pushOtaLog("reloadAsync", false, "blocked: coach/fantasy critical work");
      patchOtaRecoveryStatus({
        reloadBlocked: true,
        pending: true,
        lastOtaError: "blocked: coach/fantasy critical work",
        runningUpdateId: runningUpdateId(),
      });
      return;
    }

    const key = pendingReloadKey(availableIdRef.current);
    const report = await applyPendingOtaReloadDetailed(Updates, {
      isReloadBlocked: isOtaReloadBlocked,
      log: pushOtaLog,
      reloadUpdateKey: key,
      availableUpdateId: availableIdRef.current,
    });
    publishStatus(report, report.reloadBlocked || isOtaReloadBlocked());

    if (report.outcome === "applied") {
      reloadAttempted.current = true;
      clearGuardRetryTimer();
      return;
    }

    // Guard blocked a pending download — schedule retry; do not strand.
    if (report.lastError?.includes("reload_loop_guard")) {
      scheduleGuardRetry(key);
    }
  }, [clearGuardRetryTimer, hasPending, scheduleGuardRetry]);

  const reloadWhenSafe = useCallback(() => {
    if (reloadAttempted.current) return;
    if (!hasPending()) return;

    if (keyboardVisible.current) {
      pushOtaLog("reloadAsync", false, "blocked: keyboard visible");
      patchOtaRecoveryStatus({
        reloadBlocked: true,
        pending: true,
        lastOtaError: "blocked: keyboard visible",
        runningUpdateId: runningUpdateId(),
      });
      return;
    }
    if (isOtaReloadBlocked()) {
      pushOtaLog("reloadAsync", false, "blocked: coach/fantasy critical work");
      patchOtaRecoveryStatus({
        reloadBlocked: true,
        pending: true,
        lastOtaError: "blocked: coach/fantasy critical work",
        runningUpdateId: runningUpdateId(),
      });
      return;
    }

    clearReloadTimer();
    reloadTimer.current = setTimeout(() => {
      void applyPendingReload();
    }, SAFE_RELOAD_DELAY_MS);
  }, [applyPendingReload, clearReloadTimer, hasPending]);

  reloadWhenSafeRef.current = reloadWhenSafe;

  const prefetch = useCallback(
    async (force = false) => {
      if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;

      const now = Date.now();
      if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
      lastCheckAt.current = now;

      inFlight.current = true;
      try {
        patchOtaRecoveryStatus({
          runningUpdateId: runningUpdateId(),
          isEmergencyLaunch: !!Updates.isEmergencyLaunch,
        });
        const report = await prefetchOtaUpdateDetailed(
          Updates,
          () => updatePending.current || !!latestContext?.isUpdatePending,
          false,
          {
            isReloadBlocked: isOtaReloadBlocked,
            log: pushOtaLog,
            reloadUpdateKey: pendingReloadKey(availableIdRef.current),
          },
        );
        if (report.availableUpdateId) availableIdRef.current = report.availableUpdateId;
        publishStatus(report, report.reloadBlocked || isOtaReloadBlocked());

        if (report.outcome === "pending" || report.pending) {
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
      patchOtaRecoveryStatus({ reloadBlocked: true, lastOtaError: "blocked: keyboard visible" });
    });
    const keyboardHide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisible.current = false;
      if (!isOtaReloadBlocked()) {
        patchOtaRecoveryStatus({ reloadBlocked: false });
      }
      reloadWhenSafe();
    });

    const unsubBlock = subscribeOtaReloadBlock(() => {
      const blocked = isOtaReloadBlocked();
      patchOtaRecoveryStatus({
        reloadBlocked: blocked || keyboardVisible.current,
        lastOtaError: blocked
          ? "blocked: coach/fantasy critical work"
          : keyboardVisible.current
            ? "blocked: keyboard visible"
            : "—",
      });
      if (!blocked && !keyboardVisible.current && hasPending()) {
        reloadWhenSafe();
      }
    });

    return () => {
      clearTimeout(launchTimer);
      appState.remove();
      keyboardShow.remove();
      keyboardHide.remove();
      unsubBlock();
      clearReloadTimer();
      clearGuardRetryTimer();
    };
  }, [
    clearGuardRetryTimer,
    clearReloadTimer,
    enabled,
    hasPending,
    prefetch,
    reloadWhenSafe,
  ]);

  return false;
}
