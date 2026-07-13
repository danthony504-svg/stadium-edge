import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import { launchOtaCheckFetchReload } from "./otaLaunch";
import { formatOtaLogLines, getOtaLaunchLogs, pushOtaLog } from "./otaLaunchLog";

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
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string;
  checkAutomatically: string;
  fallbackToCacheTimeout: number;
  launchDurationMs: string;
  isUpdatePending: boolean;
  isDownloading: boolean;
  isStartupProcedureRunning: boolean;
  rollbackCommitTime: string;
  checkError: string;
  downloadError: string;
  updateUrl: string;
  requestHeaders: string;
  projectId: string;
  deployMessage: string;
  expectedCommit: string;
};

export type OtaProbeResults = {
  checkResult: string;
  fetchResult: string;
  reloadResult: string;
};

export type OtaFullDiagnostics = OtaDebugSnapshot &
  OtaProbeResults & {
    startupLogs: string[];
    jsLaunchLogs: string[];
  };

function str(v: unknown, fallback = "—"): string {
  if (v == null || v === "") return fallback;
  return String(v);
}

function formatCreatedAt(): string {
  const raw =
    (Updates as { createdAt?: Date | string | null }).createdAt ??
    (Updates.manifest as { createdAt?: string } | null)?.createdAt;
  if (!raw) return "—";
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : str(raw);
}

function readUpdatesConfig() {
  const expo = Constants.expoConfig;
  const updatesCfg = expo?.updates as
    | {
        url?: string;
        requestHeaders?: Record<string, string>;
        fallbackToCacheTimeout?: number;
        checkAutomatically?: string;
      }
    | undefined;
  return { expo, updatesCfg };
}

/** Collect static OTA deployment metadata for on-device diagnostics. */
export function readOtaDebugSnapshot(): OtaDebugSnapshot {
  const { expo, updatesCfg } = readUpdatesConfig();
  const extra = expo?.extra as { eas?: { projectId?: string } } | undefined;

  const channelHeader = updatesCfg?.requestHeaders?.["expo-channel-name"];
  const channel =
    str(Updates.channel, "") ||
    str(channelHeader, "") ||
    "embedded-at-build (no channel header in app.json)";

  const bundleSource: OtaDebugSnapshot["bundleSource"] = !Updates.isEnabled
    ? "unknown"
    : Updates.isEmbeddedLaunch
      ? "embedded"
      : "ota";

  const ctx = latestContext;
  const checkErr = ctx?.checkError;
  const downloadErr = ctx?.downloadError;

  return {
    appVersion: str(expo?.version ?? Constants.nativeAppVersion),
    buildNumber: str(Constants.nativeBuildVersion),
    runtimeVersion: str(Updates.runtimeVersion ?? expo?.runtimeVersion),
    channel,
    updateId: str(Updates.updateId, Updates.isEmbeddedLaunch ? "embedded" : "—"),
    commitHash: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked",
    updateCreatedAt: formatCreatedAt(),
    bundleSource,
    updatesEnabled: Updates.isEnabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    emergencyLaunchReason: str(Updates.emergencyLaunchReason, "—"),
    checkAutomatically: str(Updates.checkAutomatically ?? updatesCfg?.checkAutomatically, "ON_LOAD (native default)"),
    fallbackToCacheTimeout: updatesCfg?.fallbackToCacheTimeout ?? 0,
    launchDurationMs: Updates.launchDuration != null ? String(Updates.launchDuration) : "—",
    isUpdatePending: !!ctx?.isUpdatePending,
    isDownloading: !!ctx?.isDownloading,
    isStartupProcedureRunning: !!ctx?.isStartupProcedureRunning,
    rollbackCommitTime: str(ctx?.rollback?.commitTime, "—"),
    checkError: checkErr ? (checkErr instanceof Error ? checkErr.message : String(checkErr)) : "—",
    downloadError: downloadErr
      ? downloadErr instanceof Error
        ? downloadErr.message
        : String(downloadErr)
      : "—",
    updateUrl: str(updatesCfg?.url),
    requestHeaders: updatesCfg?.requestHeaders
      ? JSON.stringify(updatesCfg.requestHeaders)
      : "— (none in embedded app.json)",
    projectId: str(extra?.eas?.projectId),
    deployMessage: process.env.EXPO_PUBLIC_DEPLOY_MESSAGE ?? "—",
    expectedCommit: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "—",
  };
}

async function readStartupLogs(maxAgeMs = 3_600_000): Promise<string[]> {
  if (__DEV__ || !Updates.isEnabled) return ["skipped: dev or Updates.isEnabled=false"];
  try {
    const entries = await Updates.readLogEntriesAsync(maxAgeMs);
    if (entries.length === 0) return ["(no expo-updates log entries in last hour)"];
    return entries.map((e) => {
      const ts = e.timestamp ? new Date(e.timestamp).toISOString() : "?";
      const stack = e.stacktrace?.length ? ` | stack: ${e.stacktrace.slice(0, 2).join(" → ")}` : "";
      return `${ts} [${e.level}] ${e.code}: ${e.message}${stack}`;
    });
  } catch (e) {
    return [`readLogEntriesAsync ERR: ${e instanceof Error ? e.message : String(e)}`];
  }
}

/** Run check + fetch only (no reload) — safe for automatic diagnostics display. */
export async function probeOtaCheckAndFetch(): Promise<OtaProbeResults> {
  if (__DEV__ || !Updates.isEnabled) {
    return {
      checkResult: __DEV__ ? "skipped: __DEV__" : "skipped: Updates.isEnabled=false",
      fetchResult: "skipped",
      reloadResult: "skipped (probe does not auto-reload)",
    };
  }

  let checkResult = "—";
  let fetchResult = "—";
  const reloadResult = "not invoked (use “Check, fetch & reload” button)";

  try {
    pushOtaLog("checkForUpdateAsync", true, "diagnostics probe…");
    const check = await Updates.checkForUpdateAsync();
    const roll = (check as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded;
    checkResult = JSON.stringify({
      isAvailable: check.isAvailable,
      isRollBackToEmbedded: roll === true,
      reason: (check as { reason?: string }).reason ?? null,
    });
    pushOtaLog("checkForUpdateAsync", true, checkResult);

    if (check.isAvailable || roll) {
      try {
        pushOtaLog("fetchUpdateAsync", true, "diagnostics probe…");
        const fetch = await Updates.fetchUpdateAsync();
        fetchResult = JSON.stringify({
          isNew: (fetch as { isNew?: boolean }).isNew ?? null,
          isRollBackToEmbedded: (fetch as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded ?? false,
        });
        pushOtaLog("fetchUpdateAsync", true, fetchResult);
      } catch (e) {
        fetchResult = `ERR: ${e instanceof Error ? e.message : String(e)}`;
        pushOtaLog("fetchUpdateAsync", false, fetchResult);
      }
    } else {
      fetchResult = "skipped (check.isAvailable=false, no rollback)";
    }
  } catch (e) {
    checkResult = `ERR: ${e instanceof Error ? e.message : String(e)}`;
    fetchResult = "skipped (check failed)";
    pushOtaLog("checkForUpdateAsync", false, checkResult);
  }

  return { checkResult, fetchResult, reloadResult };
}

/** Full on-device diagnostics: static state, native logs, and live check/fetch probe. */
export async function collectOtaFullDiagnostics(): Promise<OtaFullDiagnostics> {
  const [startupLogs, probe] = await Promise.all([readStartupLogs(), probeOtaCheckAndFetch()]);
  return {
    ...readOtaDebugSnapshot(),
    ...probe,
    startupLogs,
    jsLaunchLogs: formatOtaLogLines(),
  };
}

export type OtaCheckResult = {
  downloaded: boolean;
  reloaded: boolean;
  reason?: string;
  reloadResult?: string;
};

/**
 * Check, fetch, and reload via expo-updates only — never reset React error
 * boundaries (that reopens the same in-memory JS bundle).
 */
export async function forceOtaCheckFetchAndReload(): Promise<OtaCheckResult> {
  if (__DEV__ || !Updates.isEnabled) {
    pushOtaLog("checkForUpdateAsync", false, "manual: dev or Updates disabled");
    return {
      downloaded: false,
      reloaded: false,
      reason: "Updates disabled (dev build or expo-updates off)",
      reloadResult: "skipped",
    };
  }
  const outcome = await launchOtaCheckFetchReload();
  if (outcome === "reloaded") {
    return {
      downloaded: true,
      reloaded: true,
      reloadResult: "reloadAsync invoked (app should restart)",
    };
  }

  const pending = !!latestContext?.isUpdatePending;
  if (pending) {
    try {
      pushOtaLog("reloadAsync", true, "manual: pending update…");
      await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
      return {
        downloaded: true,
        reloaded: true,
        reloadResult: "reloadAsync invoked (pending bundle)",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushOtaLog("reloadAsync", false, msg);
      return {
        downloaded: true,
        reloaded: false,
        reason: msg,
        reloadResult: `ERR: ${msg}`,
      };
    }
  }

  return {
    downloaded: false,
    reloaded: false,
    reason: "Server reports no newer update for this runtime/channel",
    reloadResult: "not invoked (no update available or pending)",
  };
}

/** @deprecated Use forceOtaCheckFetchAndReload */
export async function forceOtaCheckAndFetch(): Promise<{ isAvailable: boolean; reason?: string }> {
  const r = await forceOtaCheckFetchAndReload();
  return {
    isAvailable: r.downloaded || r.reloaded,
    reason: r.reason,
  };
}

/** @deprecated Use collectOtaFullDiagnostics */
export function getOtaLaunchLogsForDisplay(): readonly ReturnType<typeof getOtaLaunchLogs>[number][] {
  return getOtaLaunchLogs();
}
