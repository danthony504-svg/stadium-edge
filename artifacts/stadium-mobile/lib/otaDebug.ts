import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import { launchOtaCheckFetchReload } from "./otaLaunch";
import { isOtaClientEnabled } from "./otaEnabled";
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

const OTA_NETWORK_TIMEOUT_MS = 12_000;

/** Prevent expo-updates network calls from freezing the UI indefinitely. */
export async function withOtaTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = OTA_NETWORK_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  try {
    return readOtaDebugSnapshotUnsafe();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      appVersion: "—",
      buildNumber: "—",
      runtimeVersion: "—",
      channel: "—",
      updateId: "—",
      commitHash: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked",
      updateCreatedAt: "—",
      bundleSource: "unknown",
      updatesEnabled: false,
      isEmbeddedLaunch: true,
      isEmergencyLaunch: false,
      emergencyLaunchReason: "—",
      checkAutomatically: "—",
      fallbackToCacheTimeout: 0,
      launchDurationMs: "—",
      isUpdatePending: false,
      isDownloading: false,
      isStartupProcedureRunning: false,
      rollbackCommitTime: "—",
      checkError: `snapshot ERR: ${msg}`,
      downloadError: "—",
      updateUrl: "—",
      requestHeaders: "—",
      projectId: "—",
      deployMessage: process.env.EXPO_PUBLIC_DEPLOY_MESSAGE ?? "—",
      expectedCommit: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "—",
    };
  }
}

function readOtaDebugSnapshotUnsafe(): OtaDebugSnapshot {
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
  if (!isOtaClientEnabled()) return ["skipped: OTA disabled for this build"];
  try {
    const entries = await withOtaTimeout(
      "readLogEntriesAsync",
      Updates.readLogEntriesAsync(maxAgeMs),
      8_000,
    );
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

/** Run check only — never fetch on the diagnostics screen (fetch without reload corrupts the in-memory bundle). */
export async function probeOtaCheckOnly(): Promise<OtaProbeResults> {
  if (!isOtaClientEnabled()) {
    return {
      checkResult: "skipped: OTA disabled (Expo Go / dev / EXPO_PUBLIC_OTA_ENABLED≠true)",
      fetchResult: "skipped (OTA disabled)",
      reloadResult: "skipped (OTA disabled)",
    };
  }

  let checkResult = "—";
  const fetchResult =
    "skipped (check-only probe — tap “Check, fetch & reload” to download)";
  const reloadResult = "not invoked (use “Check, fetch & reload” button)";

  try {
    pushOtaLog("checkForUpdateAsync", true, "diagnostics probe (check-only)…");
    const check = await withOtaTimeout(
      "checkForUpdateAsync",
      Updates.checkForUpdateAsync(),
    );
    const roll = (check as { isRollBackToEmbedded?: boolean }).isRollBackToEmbedded;
    checkResult = JSON.stringify({
      isAvailable: check.isAvailable,
      isRollBackToEmbedded: roll === true,
      reason: (check as { reason?: string }).reason ?? null,
    });
    pushOtaLog("checkForUpdateAsync", true, checkResult);
  } catch (e) {
    checkResult = `ERR: ${e instanceof Error ? e.message : String(e)}`;
    pushOtaLog("checkForUpdateAsync", false, checkResult);
  }

  return { checkResult, fetchResult, reloadResult };
}

/** @deprecated Use probeOtaCheckOnly — automatic diagnostics must not fetch without reload. */
export async function probeOtaCheckAndFetch(): Promise<OtaProbeResults> {
  return probeOtaCheckOnly();
}

/** Full on-device diagnostics: static state, native logs, and live check/fetch probe. */
export async function collectOtaFullDiagnostics(
  timeoutMs = OTA_NETWORK_TIMEOUT_MS,
): Promise<OtaFullDiagnostics> {
  const snapshot = readOtaDebugSnapshot();
  const jsLaunchLogs = formatOtaLogLines();

  const probe = await Promise.race([
    probeOtaCheckOnly(),
    new Promise<OtaProbeResults>((resolve) =>
      setTimeout(
        () =>
          resolve({
            checkResult: `timeout after ${timeoutMs}ms`,
            fetchResult: "skipped (probe timeout)",
            reloadResult: "skipped (probe timeout)",
          }),
        timeoutMs,
      ),
    ),
  ]).catch(
    (): OtaProbeResults => ({
      checkResult: "ERR: probe failed",
      fetchResult: "skipped",
      reloadResult: "skipped",
    }),
  );

  let startupLogs: string[] = ["loading…"];
  try {
    startupLogs = await readStartupLogs();
  } catch (e) {
    startupLogs = [`readLogEntriesAsync ERR: ${e instanceof Error ? e.message : String(e)}`];
  }

  return {
    ...snapshot,
    ...probe,
    startupLogs,
    jsLaunchLogs,
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
  if (!isOtaClientEnabled()) {
    pushOtaLog("checkForUpdateAsync", false, "manual: OTA disabled");
    return {
      downloaded: false,
      reloaded: false,
      reason: "OTA disabled (Expo Go, dev build, or EXPO_PUBLIC_OTA_ENABLED≠true)",
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
