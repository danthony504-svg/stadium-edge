import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

export type OtaDebugSnapshot = {
  appVersion: string;
  buildNumber: string;
  runtimeVersion: string;
  channel: string;
  updateId: string;
  commitHash: string;
  updateCreatedAt: string;
  bundleSource: "embedded" | "ota" | "unknown";
  updatesEnabled: boolean;
  isUpdatePending: boolean;
  isDownloading: boolean;
  updateUrl: string;
  projectId: string;
  deployMessage: string;
  expectedCommit: string;
};

function str(v: unknown, fallback = "—"): string {
  if (v == null || v === "") return fallback;
  return String(v);
}

/** Collect OTA deployment metadata for on-device diagnostics. */
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

  let updateCreatedAt = "—";
  if (createdAt) {
    const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
    updateCreatedAt = Number.isFinite(d.getTime()) ? d.toISOString() : str(createdAt);
  }

  const bundleSource: OtaDebugSnapshot["bundleSource"] = !Updates.isEnabled
    ? "unknown"
    : Updates.isEmbeddedLaunch
      ? "embedded"
      : "ota";

  return {
    appVersion: str(expo?.version ?? Constants.nativeAppVersion),
    buildNumber: str(Constants.nativeBuildVersion),
    runtimeVersion: str(Updates.runtimeVersion ?? expo?.runtimeVersion),
    channel,
    updateId: str(Updates.updateId, Updates.isEmbeddedLaunch ? "embedded" : "—"),
    commitHash: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked",
    updateCreatedAt,
    bundleSource,
    updatesEnabled: Updates.isEnabled,
    isUpdatePending: !!latestContext?.isUpdatePending,
    isDownloading: !!latestContext?.isDownloading,
    updateUrl: str(updatesCfg?.url),
    projectId: str(extra?.eas?.projectId),
    deployMessage: process.env.EXPO_PUBLIC_DEPLOY_MESSAGE ?? "—",
    expectedCommit: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "—",
  };
}

export type OtaCheckResult = {
  downloaded: boolean;
  reloaded: boolean;
  reason?: string;
};

/**
 * Check, fetch, and reload via expo-updates only — never reset React error
 * boundaries (that reopens the same in-memory JS bundle).
 */
export async function forceOtaCheckFetchAndReload(): Promise<OtaCheckResult> {
  if (__DEV__ || !Updates.isEnabled) {
    return {
      downloaded: false,
      reloaded: false,
      reason: "Updates disabled (dev build or expo-updates off)",
    };
  }
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
      return { downloaded: true, reloaded: true };
    }
    const pending = !!latestContext?.isUpdatePending;
    if (pending) {
      await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
      return { downloaded: false, reloaded: true, reason: "Pending update applied via reload" };
    }
    return {
      downloaded: false,
      reloaded: false,
      reason: "Server reports no newer update for this runtime/channel",
    };
  } catch (e) {
    return {
      downloaded: false,
      reloaded: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** @deprecated Use forceOtaCheckFetchAndReload */
export async function forceOtaCheckAndFetch(): Promise<{ isAvailable: boolean; reason?: string }> {
  const r = await forceOtaCheckFetchAndReload();
  return {
    isAvailable: r.downloaded || r.reloaded,
    reason: r.reason,
  };
}
