import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import { isHomeDiscoverable } from "./slate";

export type OtaDebugSnapshot = {
  appVersion: string;
  buildNumber: string;
  runtimeVersion: string;
  updateId: string;
  commitHash: string;
  channel: string;
  lastUpdateAt: string;
  updatesEnabled: boolean;
  isEmbeddedLaunch: boolean;
  isUpdatePending: boolean;
  isDownloading: boolean;
  updateUrl: string;
  projectId: string;
  expectedCommit: string;
  bundleHasMlbFallback: boolean;
  bundleFeatureStamp: string;
};

function str(v: unknown, fallback = "—"): string {
  if (v == null || v === "") return fallback;
  return String(v);
}

/** Collect OTA / bundle metadata for the debug screen. */
export function readOtaDebugSnapshot(): OtaDebugSnapshot {
  const expo = Constants.expoConfig;
  const extra = expo?.extra as { eas?: { projectId?: string } } | undefined;
  const updatesCfg = expo?.updates as
    | { url?: string; requestHeaders?: Record<string, string> }
    | undefined;

  const channelHeader = updatesCfg?.requestHeaders?.["expo-channel-name"];
  const channel =
    str((Updates as { channel?: string }).channel, "") ||
    str(channelHeader, "") ||
    "embedded-at-build";

  const createdAt =
    (Updates as { createdAt?: Date | string | null }).createdAt ??
    (Updates.manifest as { createdAt?: string } | null)?.createdAt;

  let lastUpdateAt = "—";
  if (createdAt) {
    const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
    lastUpdateAt = Number.isFinite(d.getTime()) ? d.toISOString() : str(createdAt);
  }

  return {
    appVersion: str(expo?.version ?? Constants.nativeAppVersion),
    buildNumber: str(Constants.nativeBuildVersion),
    runtimeVersion: str(Updates.runtimeVersion ?? expo?.runtimeVersion),
    updateId: str(Updates.updateId, Updates.isEmbeddedLaunch ? "embedded" : "—"),
    commitHash: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked",
    channel,
    lastUpdateAt,
    updatesEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isUpdatePending: !!latestContext?.isUpdatePending,
    isDownloading: !!latestContext?.isDownloading,
    updateUrl: str(updatesCfg?.url),
    projectId: str(extra?.eas?.projectId),
    expectedCommit: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked",
    bundleHasMlbFallback: typeof isHomeDiscoverable === "function",
    bundleFeatureStamp: process.env.EXPO_PUBLIC_BUNDLE_STAMP ?? "unknown",
  };
}

export type OtaCheckResult = {
  isAvailable: boolean;
  reason?: string;
};

/** Run check + fetch; returns whether a new bundle was downloaded. */
export async function forceOtaCheckAndFetch(): Promise<OtaCheckResult> {
  if (__DEV__ || !Updates.isEnabled) {
    return { isAvailable: false, reason: "Updates disabled (dev build or expo-updates off)" };
  }
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return { isAvailable: false, reason: "Server reports no newer update for this runtime/channel" };
    }
    await Updates.fetchUpdateAsync();
    return { isAvailable: true };
  } catch (e) {
    return {
      isAvailable: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
