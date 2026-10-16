/**
 * Fail-soft channel resolution for Device attestation UI gating.
 * Prefer Updates.channel; fall back to app.json request header.
 * Never statically imports expo-updates (Home cold-start safe).
 */

import { tryGetExpoUpdates } from "./expoUpdatesAccess.ts";

/** Resolve the Expo Updates channel for UI visibility (null if unknown). */
export function resolveOtaChannelForUi(): string | null {
  try {
    const Updates = tryGetExpoUpdates() as { channel?: string } | null;
    const fromUpdates =
      Updates?.channel != null ? String(Updates.channel).trim() : "";
    if (fromUpdates) return fromUpdates;
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default as {
      expoConfig?: { updates?: { requestHeaders?: Record<string, string> } };
    } | null;
    const hdr = Constants?.expoConfig?.updates?.requestHeaders?.["expo-channel-name"];
    if (typeof hdr === "string" && hdr.trim()) return hdr.trim();
  } catch {
    // ignore
  }
  return null;
}
