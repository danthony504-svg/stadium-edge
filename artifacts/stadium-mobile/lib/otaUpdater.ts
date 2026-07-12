import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { isOtaReloadBlocked } from "@/lib/otaBlock";

const FOREGROUND_DEBOUNCE_MS = 45_000;
/** First OTA check shortly after Clerk loads — was 2.5s; users reopened before fetch finished. */
const LAUNCH_DELAY_MS = 400;

export type OtaPrefetchOutcome = "applied" | "pending" | "none";

/** Check expo-updates, fetch, and reload when a newer production bundle exists. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  return (await prefetchAndMaybeApplyOta(true)) === "applied";
}

/**
 * Download a production OTA when available. When `applyWhenReady` is true and
 * nothing critical is in flight (Coach build), reload immediately so users are not
 * stuck on an old bundle stamp like 076fd936.
 */
export async function prefetchAndMaybeApplyOta(
  applyWhenReady = false,
): Promise<OtaPrefetchOutcome> {
  if (__DEV__ || !Updates.isEnabled) return "none";
  if (isOtaReloadBlocked()) return "none";

  try {
    const pendingBefore = !!latestContext?.isUpdatePending;
    const result = await Updates.checkForUpdateAsync();

    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
    }

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
 * Prefetch OTA updates after launch and on foreground resume (debounced).
 * On cold launch, applies immediately when downloaded so the new bundle is active
 * before the user opens Coach.
 */
export function useOtaUpdater(enabled: boolean) {
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const launchApplied = useRef(false);

  const prefetch = useCallback(async (force = false, applyWhenReady = false) => {
    if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;

    const now = Date.now();
    if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
    lastCheckAt.current = now;

    inFlight.current = true;
    try {
      const shouldApply = applyWhenReady || (force && !launchApplied.current);
      const outcome = await prefetchAndMaybeApplyOta(shouldApply);
      if (outcome === "applied") launchApplied.current = true;
    } catch {
      // Network hiccup — next foreground will retry.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const launchTimer = setTimeout(
      () => void prefetch(true, true),
      LAUNCH_DELAY_MS,
    );
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void prefetch(false, false);
    });

    return () => {
      clearTimeout(launchTimer);
      sub.remove();
    };
  }, [enabled, prefetch]);

  return false;
}
