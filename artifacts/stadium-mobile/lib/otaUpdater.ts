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
  markBundleAppliedIfReady,
  markOtaEpochApplied,
  needsBrowseSportsBundleReload,
  needsOtaEpochUpgrade,
} from "@/lib/bundleMark";
import {
  bumpColdStartReloadAttempts,
  clearColdStartReloadAttempts,
  readColdStartReloadAttempts,
} from "@/lib/otaReloadGuard";

const FOREGROUND_DEBOUNCE_MS = 45_000;
const LAUNCH_DELAY_MS = 2500;
/** Stop infinite reload loops when OTA cannot advance (offline / already latest). */
const MAX_COLD_START_RELOADS = 2;

async function reloadWithFreshCache(): Promise<void> {
  await clearDiscoverCache();
  await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
}

/**
 * Reload at most MAX_COLD_START_RELOADS times per successful boot.
 * Returns false when the cap is hit — caller should continue boot instead of looping.
 */
async function guardedColdStartReload(): Promise<boolean> {
  const attempts = await readColdStartReloadAttempts();
  if (attempts >= MAX_COLD_START_RELOADS) {
    return false;
  }
  await bumpColdStartReloadAttempts();
  await reloadWithFreshCache();
  return true;
}

/** Fetch the latest production OTA when the server has one. Returns true when fetched. */
async function fetchLatestOtaIfAvailable(): Promise<boolean> {
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

async function prefetchOtaUpdate(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;
  try {
    return await fetchLatestOtaIfAvailable();
  } catch {
    return false;
  }
}

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
 * On cold start: apply a pending OTA or fetch once when corrupt.
 * Never reload blindly — that was trapping users on a white/navy spinner loop.
 */
export async function applyOtaOnColdStart(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  if (latestContext?.isUpdatePending) {
    const reloaded = await guardedColdStartReload();
    if (!reloaded) await markSuccessfulOtaBoot();
    return reloaded;
  }

  const lastCrash = await readLastBootCrash();
  const hadCorruptCrash = !!lastCrash && isKnownCorruptCrashMessage(lastCrash);
  const browseStale = await needsBrowseSportsBundleReload();

  if (hadCorruptCrash || browseStale) {
    let fetched = false;
    try {
      fetched = await fetchLatestOtaIfAvailable();
    } catch {
      // offline
    }
    if (fetched) {
      const reloaded = await guardedColdStartReload();
      if (!reloaded && browseSportsBundleReady()) await markSuccessfulOtaBoot();
      return reloaded;
    }
    // Stay on corrupt bundle offline — do not stamp epoch; crash UI will retry.
    return false;
  }

  if (await needsOtaEpochUpgrade()) {
    let fetched = false;
    try {
      fetched = await fetchLatestOtaIfAvailable();
    } catch {
      // offline
    }
    if (fetched) {
      const reloaded = await guardedColdStartReload();
      if (!reloaded) await markSuccessfulOtaBoot();
      return reloaded;
    }
    // Already on the newest bundle — stamp epoch without reloading.
    await markOtaEpochApplied();
  }

  try {
    await prefetchOtaUpdate();
  } catch {
    // offline
  }

  await markSuccessfulOtaBoot();
  return false;
}

/** Mark a successful boot after OTA gate releases the UI. */
export async function markSuccessfulOtaBoot(): Promise<void> {
  if (!browseSportsBundleReady()) return;
  await markBundleAppliedIfReady();
  await markOtaEpochApplied();
  await clearLastBootCrash();
  await clearColdStartReloadAttempts();
}

export async function applyPendingOtaOnLaunch(): Promise<boolean> {
  return applyOtaOnColdStart();
}

export async function recoverFromCorruptOta(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  await clearDiscoverCache();
  await clearAppliedBundleMark();

  try {
    if (await fetchLatestOtaIfAvailable()) {
      return await guardedColdStartReload();
    }
  } catch {
    // fall through
  }

  return await guardedColdStartReload();
}

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

export async function applyOtaUpdateIfAvailable(): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return false;

  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return true;
}

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
