import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import { browseSportsBundleReady } from "@/lib/browseSportsGuard";
import {
  clearAppliedBundleMark,
  markBundleAppliedIfReady,
  needsBrowseSportsBundleReload,
} from "@/lib/bundleMark";

const FOREGROUND_DEBOUNCE_MS = 45_000;
/** Wait for Clerk + first paint before prefetching OTA — avoids competing with home data. */
const LAUNCH_DELAY_MS = 2500;

async function reloadWithFreshCache(): Promise<void> {
  await clearDiscoverCache();
  await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
}

/** Download an OTA bundle without reloading — applies on the next cold start. */
async function prefetchOtaUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return false;

  await Updates.fetchUpdateAsync();
  return true;
}

/**
 * Apply any downloaded or fetchable OTA before entering table tennis / cricket /
 * tennis browse flows. Returns true when reloadAsync was invoked (caller should abort).
 */
export async function ensureBrowseSportOtaReady(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  if (latestContext?.isUpdatePending) {
    await reloadWithFreshCache();
    return true;
  }

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return false;
    await Updates.fetchUpdateAsync();
    await reloadWithFreshCache();
    return true;
  } catch {
    return false;
  }
}

/**
 * On cold start: apply a downloaded OTA, or prefetch a newer one.
 * Never force-reload just because the server has a newer bundle — that was
 * bricking users in a reload loop with corrupt in-memory JS.
 */
export async function applyOtaOnColdStart(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  if (latestContext?.isUpdatePending) {
    await reloadWithFreshCache();
    return true;
  }

  if (await needsBrowseSportsBundleReload()) {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) await Updates.fetchUpdateAsync();
    } catch {
      // Offline — still try reload to apply a previously downloaded bundle.
    }
    await reloadWithFreshCache();
    return true;
  }

  try {
    await prefetchOtaUpdate();
  } catch {
    // Offline — boot with the current bundle.
  }

  await markBundleAppliedIfReady();
  return false;
}

/** On cold start, reload immediately when a downloaded OTA is waiting to apply. */
export async function applyPendingOtaOnLaunch(): Promise<boolean> {
  return applyOtaOnColdStart();
}

/**
 * Fetch the latest OTA and reload after stale-bundle Hermes crashes.
 * Clears bundle-mark + discover cache so the next boot does not re-enter a reload loop.
 */
export async function recoverFromCorruptOta(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  await clearDiscoverCache();
  await clearAppliedBundleMark();

  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) {
      await Updates.fetchUpdateAsync();
      await reloadWithFreshCache();
      return true;
    }
  } catch {
    // Fall through to a plain reload.
  }

  await reloadWithFreshCache();
  return true;
}

/**
 * Run a browse-sport action only after this bundle supports table tennis helpers
 * and any downloaded OTA has been applied. Reloads when needed.
 */
export async function runWhenBrowseSportBundleReady(action: () => void): Promise<void> {
  if (!browseSportsBundleReady()) {
    if (Updates.isEnabled) {
      await reloadWithFreshCache();
    }
    return;
  }
  const reloading = await ensureBrowseSportOtaReady();
  if (!reloading) action();
}

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
 * Prefetch OTA updates after launch and on foreground resume (debounced).
 * Never calls reloadAsync automatically — mid-session reload was wiping query
 * cache (Discover flash) and aborting Coach parlay streams.
 */
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
      await prefetchOtaUpdate();
    } catch {
      // Network hiccup — next foreground will retry.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const launchTimer = setTimeout(() => void prefetch(true), LAUNCH_DELAY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void prefetch();
    });

    return () => {
      clearTimeout(launchTimer);
      sub.remove();
    };
  }, [enabled, prefetch]);

  return false;
}
