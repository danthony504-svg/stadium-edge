import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const FOREGROUND_DEBOUNCE_MS = 45_000;

/** Check expo-updates, fetch, and reload when a newer production bundle exists. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return false;

  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return true;
}

/** Check on launch and on foreground resume (debounced). */
export function useOtaUpdater(enabled: boolean) {
  const [updating, setUpdating] = useState(false);
  const inFlight = useRef(false);
  const lastCheckAt = useRef(0);

  const check = useCallback(async (force = false) => {
    if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;

    const now = Date.now();
    if (!force && now - lastCheckAt.current < FOREGROUND_DEBOUNCE_MS) return;
    lastCheckAt.current = now;

    inFlight.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      setUpdating(true);
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      // Network hiccup — next foreground will retry.
    } finally {
      inFlight.current = false;
      setUpdating(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    void check(true);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });

    return () => sub.remove();
  }, [enabled, check]);

  return updating;
}
