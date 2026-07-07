import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import {
  clearLastBootCrash,
  isKnownCorruptCrashMessage,
  readLastBootCrash,
} from "@/lib/crashRecovery";
import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import { browseSportsBundleReady } from "@/lib/browseSportsGuard";
import {
  clearAppliedBundleMark,
  clearOtaEpoch,
  markBundleAppliedIfReady,
  markOtaEpochApplied,
  needsBrowseSportsBundleReload,
  needsOtaEpochUpgrade,
} from "@/lib/bundleMark";

const FOREGROUND_DEBOUNCE_MS = 45_000;
/** Wait for Clerk + first paint before prefetching OTA — avoids competing with home data. */
const LAUNCH_DELAY_MS = 2500;

async function reloadWithFreshCache(): Promise<void> {
  await clearDiscoverCache();
  await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
}

/** Fetch the latest production OTA when the server has one. Returns true when fetched. */
async function fetchLatestOtaIfAvailable(): Promise<boolean> {
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

/** Download an OTA bundle without reloading — applies on the next cold start. */
async function prefetchOtaUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  try {
    return await fetchLatestOtaIfAvailable();
  } catch {
    return false;
  }
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
    if (await fetchLatestOtaIfAvailable()) {
      await reloadWithFreshCache();
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * On cold start: apply any downloaded or server-newer OTA before the UI loads.
 * Uses OTA epoch + last-crash markers so corrupt bundles cannot skip the fix.
 */
export async function applyOtaOnColdStart(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  if (latestContext?.isUpdatePending) {
    await reloadWithFreshCache();
    return true;
  }

  const lastCrash = await readLastBootCrash();
  const hadCorruptCrash = !!lastCrash && isKnownCorruptCrashMessage(lastCrash);
  const mustUpgrade =
    hadCorruptCrash ||
    (await needsOtaEpochUpgrade()) ||
    (await needsBrowseSportsBundleReload());

  if (mustUpgrade) {
    try {
      await fetchLatestOtaIfAvailable();
    } catch {
      // Offline — still try reload to apply a previously downloaded bundle.
    }
    await reloadWithFreshCache();
    return true;
  }

  try {
    if (await fetchLatestOtaIfAvailable()) {
      await reloadWithFreshCache();
      return true;
    }
  } catch {
    // Offline — boot with the current bundle.
  }

  await markBundleAppliedIfReady();
  await markOtaEpochApplied();
  await clearLastBootCrash();
  return false;
}

/** Mark a successful boot after OTA gate releases the UI. */
export async function markSuccessfulOtaBoot(): Promise<void> {
  await markBundleAppliedIfReady();
  await markOtaEpochApplied();
  await clearLastBootCrash();
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
  await clearOtaEpoch();

  try {
    if (await fetchLatestOtaIfAvailable()) {
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
