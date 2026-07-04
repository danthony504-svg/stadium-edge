import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const FOREGROUND_DEBOUNCE_MS = 45_000;
/** Wait for Clerk + first paint before prefetching OTA — avoids competing with home data. */
const LAUNCH_DELAY_MS = 5000;

/** Check expo-updates, fetch, and reload when a newer production bundle exists. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return false;

  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return true;
}

/**
 * Prefetch an OTA on launch without reloading — the downloaded bundle applies on
 * the next cold start so the current session's UI and query cache stay intact.
 */
async function prefetchOtaOnLaunch(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return false;

  await Updates.fetchUpdateAsync();
  return true;
}

/** Prefetch after launch; reload only when returning from background (debounced). */
export function useOtaUpdater(enabled: boolean) {
  const [updating, setUpdating] = useState(false);
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const checkAndReload = useCallback(async (force = false) => {
    if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;

    const now = Date.now();
    if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
    lastCheckAt.current = now;

    inFlight.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable || !mounted.current) return;
      setUpdating(true);
      await Updates.fetchUpdateAsync();
      if (!mounted.current) return;
      await Updates.reloadAsync();
    } catch {
      // Network hiccup — next foreground will retry.
    } finally {
      if (mounted.current) setUpdating(false);
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const launchTimer = setTimeout(() => void prefetchOtaOnLaunch(), LAUNCH_DELAY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkAndReload();
    });

    return () => {
      clearTimeout(launchTimer);
      sub.remove();
    };
  }, [enabled, checkAndReload]);

  return updating;
}
