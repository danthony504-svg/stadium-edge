import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import { isOtaReloadBlocked } from "./otaBlock";
import { pushOtaLog } from "./otaLaunchLog";
import {
  GUARD_WINDOW_MS,
  shouldAllowAutoReload,
  type OtaReloadGuard,
} from "./otaReloadGuard";

const GUARD_KEY = "@stadium/ota-auto-reload-guard";

export type { OtaReloadGuard } from "./otaReloadGuard";
export { shouldAllowAutoReload } from "./otaReloadGuard";

export function isOtaUpdatePending(): boolean {
  return !!latestContext?.isUpdatePending;
}

/** True when embedded JS has a downloaded OTA waiting — never while already on an OTA bundle. */
export function shouldApplyDownloadedOta(): boolean {
  if (__DEV__ || !Updates.isEnabled) return false;
  if (!Updates.isEmbeddedLaunch) return false;
  return isOtaUpdatePending();
}

async function readGuard(): Promise<OtaReloadGuard | null> {
  try {
    const raw = await AsyncStorage.getItem(GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OtaReloadGuard;
    if (!parsed?.updateId || typeof parsed.attempts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeGuard(guard: OtaReloadGuard): Promise<void> {
  try {
    await AsyncStorage.setItem(GUARD_KEY, JSON.stringify(guard));
  } catch {
    // best-effort
  }
}

export async function clearOtaReloadGuard(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GUARD_KEY);
  } catch {
    // best-effort
  }
}

/** Running the OTA bundle (not embedded) — clear loop guard from prior attempts. */
export async function noteOtaBundleActive(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return;
  if (!Updates.isEmbeddedLaunch) {
    await clearOtaReloadGuard();
  }
}

export async function canAutoReloadPending(updateId?: string | null): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;
  if (isOtaReloadBlocked()) return false;
  if (!shouldApplyDownloadedOta()) return false;

  const id = updateId ?? String(Updates.updateId ?? "pending");
  const guard = await readGuard();
  return shouldAllowAutoReload(guard, id);
}

async function recordReloadAttempt(updateId: string): Promise<void> {
  const guard = await readGuard();
  const now = Date.now();
  if (!guard || guard.updateId !== updateId || now - guard.firstAttemptAt > GUARD_WINDOW_MS) {
    await writeGuard({ updateId, attempts: 1, firstAttemptAt: now });
    return;
  }
  await writeGuard({ ...guard, attempts: guard.attempts + 1 });
}

/**
 * Reload into a downloaded OTA once, with per-update attempt limits so error
 * recovery cannot spin forever when a bundle crashes on load.
 */
export async function safeReloadPendingOta(reason: string): Promise<boolean> {
  if (!shouldApplyDownloadedOta()) return false;

  const updateId = String(Updates.updateId ?? "pending");
  if (!(await canAutoReloadPending(updateId))) {
    pushOtaLog(
      "reloadAsync",
      false,
      `skipped auto-reload (${reason}): loop guard for ${updateId.slice(0, 8)}`,
    );
    return false;
  }

  try {
    await recordReloadAttempt(updateId);
    pushOtaLog("reloadAsync", true, `auto (${reason}) update=${updateId.slice(0, 8)}…`);
    await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushOtaLog("reloadAsync", false, `auto (${reason}) ERR: ${msg}`);
    return false;
  }
}
