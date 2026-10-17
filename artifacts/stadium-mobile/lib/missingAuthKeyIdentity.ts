/**
 * Identity + recovery helpers for the missing-auth-key early return.
 * Must work without ClerkProvider / AppShell (OTA is otherwise unreachable).
 */

import { tryGetExpoUpdates } from "./expoUpdatesAccess.ts";

export type MissingAuthBundleIdentity = {
  updateId: string;
  channel: string;
  bakedSha: string;
};

/** Baked commit string inlined at export time (same source as Device attestation). */
export function readBakedGitCommit(): string {
  const raw = process.env.EXPO_PUBLIC_GIT_COMMIT;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "not-baked";
}

/**
 * Resolve updateId / channel / baked SHA without Clerk.
 * Fail-soft: never throws; unknown fields become "—".
 */
export function readMissingAuthBundleIdentity(): MissingAuthBundleIdentity {
  let updateId = "—";
  let channel = "—";
  try {
    const Updates = tryGetExpoUpdates();
    if (Updates?.updateId != null && String(Updates.updateId).trim()) {
      updateId = String(Updates.updateId).trim();
    }
    if (Updates?.channel != null && String(Updates.channel).trim()) {
      channel = String(Updates.channel).trim();
    }
  } catch {
    // ignore
  }
  if (channel === "—") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Constants = require("expo-constants").default as {
        expoConfig?: { updates?: { requestHeaders?: Record<string, string> } };
      } | null;
      const hdr =
        Constants?.expoConfig?.updates?.requestHeaders?.["expo-channel-name"];
      if (typeof hdr === "string" && hdr.trim()) channel = hdr.trim();
    } catch {
      // ignore
    }
  }
  return { updateId, channel, bakedSha: readBakedGitCommit() };
}

export type PreClerkOtaRecoveryOutcome =
  | "reloaded"
  | "idle"
  | "unavailable"
  | "error";

/**
 * Manual check/fetch/reload reachable from the missing-key screen.
 * Uses fail-soft expo-updates access (no static import).
 */
export async function runPreClerkOtaRecovery(): Promise<PreClerkOtaRecoveryOutcome> {
  if (typeof __DEV__ !== "undefined" && __DEV__) return "unavailable";
  const Updates = tryGetExpoUpdates();
  if (!Updates?.isEnabled) return "unavailable";
  try {
    const check = await Updates.checkForUpdateAsync();
    const rollBack = !!(check as { isRollBackToEmbedded?: boolean })
      .isRollBackToEmbedded;
    if (rollBack || check.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
      return "reloaded";
    }
    const pending = !!(Updates as { isUpdatePending?: boolean }).isUpdatePending;
    if (pending) {
      await Updates.reloadAsync();
      return "reloaded";
    }
    return "idle";
  } catch {
    return "error";
  }
}
