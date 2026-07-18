import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { isOtaReloadBlocked } from "@/lib/otaBlock";

const FOREGROUND_DEBOUNCE_MS = 45_000;

export type OtaPrefetchOutcome = "applied" | "pending" | "none";

/** @deprecated Startup auto-apply removed. Use Menu → OTA Diagnostics to reload. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  return (await prefetchOtaInBackground()) === "pending";
}

/**
 * Background fetch only — never calls reloadAsync.
 * User applies via OtaUpdateBanner or OTA Diagnostics.
 */
export async function prefetchOtaInBackground(): Promise<OtaPrefetchOutcome> {
  if (__DEV__ || !Updates.isEnabled || isOtaReloadBlocked()) return "none";

  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
    }
    return !!latestContext?.isUpdatePending ? "pending" : "none";
  } catch {
    return "none";
  }
}

/**
 * Coach / foreground hook: prefetch a production OTA without auto-reload.
 * Reload remains user-driven via OtaUpdateBanner or OTA Diagnostics.
 */
export async function prefetchAndMaybeApplyOta(_force = false): Promise<void> {
  if (__DEV__ || !Updates.isEnabled || isOtaReloadBlocked()) return;

  try {
    await prefetchOtaInBackground();
  } catch (err) {
    console.warn("[ota] prefetch failed", err);
  }
}

/** @deprecated Not mounted from _layout. Foreground fetch-only if used elsewhere. */
export function useOtaUpdater(enabled: boolean) {
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);

  const prefetch = useCallback(async (force = false) => {
    if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;

    const now = Date.now();
    if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
    lastCheckAt.current = now;

    inFlight.current = true;
    try {
      await prefetchOtaInBackground();
    } catch {
      // Network hiccup — next foreground will retry.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void prefetch(false);
    });
    return () => sub.remove();
  }, [enabled, prefetch]);

  return false;
}
