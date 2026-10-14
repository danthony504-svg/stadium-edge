/**
 * Production OtaClient backed by lazy expo-updates access.
 * Kept out of the React tree import graph until DeferredOtaRuntime loads.
 */

import { tryGetExpoUpdates, tryGetLatestContext } from "../expoUpdatesAccess.ts";
import type { OtaClient, OtaCheckResult, OtaFetchResult } from "./types.ts";

function readManifestId(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object") return null;
  const id = (manifest as { id?: unknown }).id;
  if (id == null || id === "") return null;
  return String(id);
}

export function createExpoOtaClient(): OtaClient {
  return {
    isEnabled() {
      if (typeof __DEV__ !== "undefined" && __DEV__) return false;
      const Updates = tryGetExpoUpdates();
      return !!Updates?.isEnabled;
    },

    getRunningUpdateId() {
      const Updates = tryGetExpoUpdates();
      if (!Updates?.updateId) return null;
      return String(Updates.updateId);
    },

    getDownloadedUpdateId() {
      const ctx = tryGetLatestContext() as {
        downloadedManifest?: { id?: string } | null;
      } | null;
      return readManifestId(ctx?.downloadedManifest);
    },

    isEmbeddedLaunch() {
      const Updates = tryGetExpoUpdates();
      return !!Updates?.isEmbeddedLaunch;
    },

    isEmergencyLaunch() {
      const Updates = tryGetExpoUpdates();
      return !!Updates?.isEmergencyLaunch;
    },

    emergencyLaunchReason() {
      const Updates = tryGetExpoUpdates();
      const reason = (Updates as { emergencyLaunchReason?: unknown } | null)
        ?.emergencyLaunchReason;
      if (reason == null || reason === "") return null;
      return String(reason);
    },

    isStartupProcedureRunning() {
      const ctx = tryGetLatestContext() as {
        isStartupProcedureRunning?: boolean;
      } | null;
      return !!ctx?.isStartupProcedureRunning;
    },

    async checkForUpdateAsync(): Promise<OtaCheckResult> {
      const Updates = tryGetExpoUpdates();
      if (!Updates) {
        return { isAvailable: false, reason: "expo-updates unavailable" };
      }
      const check = await Updates.checkForUpdateAsync();
      const isRollBackToEmbedded = !!(check as { isRollBackToEmbedded?: boolean } | null)
        ?.isRollBackToEmbedded;
      return {
        isAvailable: !!check?.isAvailable || isRollBackToEmbedded,
        isRollBackToEmbedded,
        reason: (check as { reason?: string } | null)?.reason ?? null,
        manifestId: readManifestId(check?.manifest),
      };
    },

    async fetchUpdateAsync(): Promise<OtaFetchResult> {
      const Updates = tryGetExpoUpdates();
      if (!Updates) return { isNew: false, manifestId: null };
      const fetched = await Updates.fetchUpdateAsync();
      const isRollBackToEmbedded = !!(fetched as { isRollBackToEmbedded?: boolean } | null)
        ?.isRollBackToEmbedded;
      return {
        isNew: !!(fetched as { isNew?: boolean } | null)?.isNew || isRollBackToEmbedded,
        isRollBackToEmbedded,
        manifestId: readManifestId(
          (fetched as { manifest?: unknown } | null)?.manifest,
        ),
      };
    },

    async reloadAsync() {
      const Updates = tryGetExpoUpdates();
      if (!Updates) throw new Error("expo-updates unavailable");
      const ctx = tryGetLatestContext() as {
        downloadedManifest?: { id?: string } | null;
        isUpdatePending?: boolean;
      } | null;
      const pending = !!ctx?.isUpdatePending;
      // Already on embedded with nothing pending — skip (true no-op).
      // Do NOT skip when running tip UUID == downloadedManifest.id: channel
      // rollBackToEmbedded often leaves that equality while isUpdatePending
      // is true; a no-op here would strand Restart on the broken tip.
      if (Updates.isEmbeddedLaunch && !pending) {
        return;
      }
      // Bare reload — avoid reloadScreenOptions which older Build 78 native
      // surfaces may reject; maximize apply success on the shipping binary.
      // Distinct-target / already-on-target gates live in OtaController.restart.
      await Updates.reloadAsync();
    },
  };
}
