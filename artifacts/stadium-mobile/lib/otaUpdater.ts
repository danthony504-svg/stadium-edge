import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Keyboard } from "react-native";

import { isOtaReloadBlocked } from "@/lib/otaBlock";

const FOREGROUND_DEBOUNCE_MS = 45_000;
const LAUNCH_DELAY_MS = 400;
const SAFE_RELOAD_DELAY_MS = 1_000;

export type OtaPrefetchOutcome = "applied" | "pending" | "none";

/** Retained for error-recovery flows; normal startup uses the deferred hook. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  return (await prefetchAndMaybeApplyOta(true)) === "applied";
}

/** Fetch a compatible update without disrupting the currently running bundle. */
export async function prefetchAndMaybeApplyOta(
  applyWhenReady = false,
): Promise<OtaPrefetchOutcome> {
  if (__DEV__ || !Updates.isEnabled || isOtaReloadBlocked()) return "none";
  try {
    const pendingBefore = !!latestContext?.isUpdatePending;
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();

    const pending = !!latestContext?.isUpdatePending || pendingBefore;
    if (!pending) return "none";
    if (applyWhenReady && !isOtaReloadBlocked()) {
      await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
      return "applied";
    }
    return "pending";
  } catch {
    return "none";
  }
}

/**
 * Non-blocking production updater. It checks only after launch and meaningful
 * foregrounding, fetches silently, and reloads once after inputs and protected
 * activities (Coach/Fantasy analysis) are idle.
 */
export function useOtaUpdater(enabled: boolean) {
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const reloadAttempted = useRef(false);
  const keyboardVisible = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReloadTimer = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = null;
  }, []);

  const reloadWhenSafe = useCallback(() => {
    if (reloadAttempted.current || keyboardVisible.current || isOtaReloadBlocked() || !latestContext?.isUpdatePending) return;
    clearReloadTimer();
    reloadTimer.current = setTimeout(() => {
      if (reloadAttempted.current || keyboardVisible.current || isOtaReloadBlocked() || !latestContext?.isUpdatePending) return;
      reloadAttempted.current = true;
      void Updates.reloadAsync({ reloadScreenOptions: { fade: true } }).catch(() => {
        // Reload failure must leave the current working bundle usable.
        reloadAttempted.current = false;
      });
    }, SAFE_RELOAD_DELAY_MS);
  }, [clearReloadTimer]);

  const prefetch = useCallback(async (force = false) => {
    if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;
    const now = Date.now();
    if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
    lastCheckAt.current = now;
    inFlight.current = true;
    try {
      if ((await prefetchAndMaybeApplyOta(false)) === "pending") reloadWhenSafe();
    } finally {
      inFlight.current = false;
    }
  }, [enabled, reloadWhenSafe]);

  useEffect(() => {
    if (!enabled) return;
    const launchTimer = setTimeout(() => void prefetch(true), LAUNCH_DELAY_MS);
    let backgroundAt = 0;
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") backgroundAt = Date.now();
      if (state === "active") {
        if (latestContext?.isUpdatePending) reloadWhenSafe();
        if (backgroundAt && Date.now() - backgroundAt >= FOREGROUND_DEBOUNCE_MS) void prefetch(false);
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
  }, [clearReloadTimer, enabled, prefetch, reloadWhenSafe]);
}
