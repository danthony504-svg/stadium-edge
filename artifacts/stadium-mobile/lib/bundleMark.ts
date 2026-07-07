import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

import { browseSportsBundleReady } from "./browseSportsGuard";

/** Bump when Table Tennis / browse-sport crash fixes ship — tracked in AsyncStorage only. */
export const JS_BUNDLE_MARK = "tabletennis-v10";

/** Bump to force one fetch+apply OTA cycle for installs stuck on corrupt bundles. */
export const REQUIRED_OTA_EPOCH = 10;

const STORAGE_KEY = "stadium-js-bundle-mark";
const OTA_EPOCH_KEY = "stadium-ota-epoch";

export function expectedBundleMark(): string {
  const fromConfig = (Constants.expoConfig?.extra as { jsBundleMark?: string } | undefined)
    ?.jsBundleMark;
  return String(fromConfig ?? JS_BUNDLE_MARK);
}

export async function readAppliedBundleMark(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function writeAppliedBundleMark(mark: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mark);
  } catch {
    // Best-effort
  }
}

export async function clearAppliedBundleMark(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort
  }
}

export async function needsOtaEpochUpgrade(): Promise<boolean> {
  if (__DEV__) return false;
  try {
    const applied = await AsyncStorage.getItem(OTA_EPOCH_KEY);
    return applied !== String(REQUIRED_OTA_EPOCH);
  } catch {
    return true;
  }
}

export async function markOtaEpochApplied(): Promise<void> {
  if (__DEV__) return;
  try {
    await AsyncStorage.setItem(OTA_EPOCH_KEY, String(REQUIRED_OTA_EPOCH));
  } catch {
    // Best-effort
  }
}

export async function clearOtaEpoch(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OTA_EPOCH_KEY);
  } catch {
    // Best-effort
  }
}

/** True when this install has applied the current JS bundle mark. */
export async function isBundleMarkCurrent(): Promise<boolean> {
  if (__DEV__) return true;
  const applied = await readAppliedBundleMark();
  return applied === expectedBundleMark();
}

/** Gate Table Tennis / Cricket UI — requires fixed browse guard + applied bundle mark. */
export function browseSportsUiEnabled(): boolean {
  return browseSportsBundleReady();
}

export async function markBundleAppliedIfReady(): Promise<void> {
  if (__DEV__ || !browseSportsBundleReady()) return;
  await writeAppliedBundleMark(expectedBundleMark());
}

/**
 * True only when this in-memory bundle lacks browse-sport helpers (stale OTA).
 * Do NOT key off the AsyncStorage mark — a good bundle with no mark yet must not reload.
 */
export async function needsBrowseSportsBundleReload(): Promise<boolean> {
  if (__DEV__) return false;
  return !browseSportsBundleReady();
}
