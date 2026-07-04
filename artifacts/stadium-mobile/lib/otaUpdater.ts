import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const POLL_MS = 12_000;
const POLL_WINDOW_MS = 180_000;

/** Check expo-updates, fetch, and reload when a newer production bundle exists. */
export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return false;

  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return true;
}

/** Poll on launch and on every foreground resume until an OTA is applied. */
export function useOtaUpdater(enabled: boolean) {
  const [updating, setUpdating] = useState(false);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (__DEV__ || !enabled || !Updates.isEnabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      setUpdating(true);
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      // Network hiccup — the poll / foreground listener will retry.
    } finally {
      inFlight.current = false;
      setUpdating(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    void check();
    const poll = setInterval(() => void check(), POLL_MS);
    const stopPoll = setTimeout(() => clearInterval(poll), POLL_WINDOW_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });

    return () => {
      clearInterval(poll);
      clearTimeout(stopPoll);
      sub.remove();
    };
  }, [enabled, check]);

  return updating;
}
