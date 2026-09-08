import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard } from "react-native";

import { isOtaReloadBlocked } from "@/lib/otaBlock";
import { pushOtaLog } from "@/lib/otaLaunchLog";
import {
  prefetchOtaUpdate,
  resetOtaUpdaterSessionGuardForTests,
  type OtaPrefetchOutcome,
} from "@/lib/otaUpdaterCore";

export type { OtaPrefetchOutcome, OtaUpdateClient, OtaFetchResult } from "@/lib/otaUpdaterCore";
export { prefetchOtaUpdate, resetOtaUpdaterSessionGuardForTests };

const FOREGROUND_DEBOUNCE_MS = 45_000;
const LAUNCH_DELAY_MS = 400;
const SAFE_RELOAD_DELAY_MS = 1_000;

function reloadUpdateKey(): string {
  const downloaded = latestContext?.downloadedManifest as { id?: string } | null | undefined;
  return String(Updates.updateId ?? downloaded?.id ?? "pending");
}

/**
 * Prefetch (and optionally apply) a production OTA.
 * Reload guards must not skip check/fetch — they only delay reload.
 */
export async function prefetchAndMaybeApplyOta(
  applyWhenReady = false,
): Promise<OtaPrefetchOutcome> {
  if (__DEV__ || !Updates.isEnabled) return "none";
  return prefetchOtaUpdate(
    Updates,
    () => !!latestContext?.isUpdatePending,
    applyWhenReady,
    {
      isReloadBlocked: isOtaReloadBlocked,
      log: pushOtaLog,
      reloadUpdateKey: reloadUpdateKey(),
    },
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

  const reloadWhenSafe = useCallback(() => {
    if (reloadAttempted.current) return;
    if (!hasPending()) return;
    if (keyboardVisible.current) {
      pushOtaLog("reloadAsync", false, "blocked: keyboard visible");
      return;
    }
    if (isOtaReloadBlocked()) {
      pushOtaLog("reloadAsync", false, "blocked: coach/fantasy critical work");
      return;
    }

    clearReloadTimer();
    reloadTimer.current = setTimeout(() => {
      if (reloadAttempted.current || !hasPending()) return;
      if (keyboardVisible.current) {
        pushOtaLog("reloadAsync", false, "blocked: keyboard visible");
        return;
      }
      if (isOtaReloadBlocked()) {
        pushOtaLog("reloadAsync", false, "blocked: coach/fantasy critical work");
        return;
      }

      void prefetchOtaUpdate(
        Updates,
        hasPending,
        true,
        {
          isReloadBlocked: isOtaReloadBlocked,
          log: pushOtaLog,
          reloadUpdateKey: reloadUpdateKey(),
        },
      ).then((outcome) => {
        if (outcome === "applied") reloadAttempted.current = true;
      });
    }, SAFE_RELOAD_DELAY_MS);
  }, [clearReloadTimer, hasPending]);

  const prefetch = useCallback(
    async (force = false) => {
      if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;

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

    return () => {
      clearTimeout(launchTimer);
      appState.remove();
      keyboardShow.remove();
      keyboardHide.remove();
      clearReloadTimer();
    };
  }, [clearReloadTimer, enabled, hasPending, prefetch, reloadWhenSafe]);

  return false;
}
