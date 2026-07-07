import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

import { browseSportsBundleReady } from "./browseSportsGuard";

/** Bump when Table Tennis / browse-sport crash fixes ship — tracked in AsyncStorage only. */
export const JS_BUNDLE_MARK = "tabletennis-v5";

const STORAGE_KEY = "stadium-js-bundle-mark";

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
