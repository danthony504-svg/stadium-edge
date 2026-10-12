import Constants from "expo-constants";

import {
  EXPECTED_HEALTHY_EMBEDDED,
  EXPECTED_HEALTHY_RUNTIME,
  EXPECTED_HEALTHY_UPDATE_ID,
  caseCNativeModuleSafetyReport,
  classifyDeviceAttestation,
  expectedHealthyLines,
  type DeviceAttestationResult,
} from "./otaDeviceAttestation";
import { COACH_PIPELINE_VERSION } from "./coach/qualifyCoachCandidate";
import { expoUpdatesLoadError, tryGetExpoUpdates, tryGetLatestContext } from "./expoUpdatesAccess";
import { formatOtaLogLines, getOtaLaunchLogs, pushOtaLog } from "./otaLaunchLog";
import {
  collectOtaBannerTrace,
  formatOtaBannerTraceLines,
  type OtaBannerTraceSnapshot,
} from "./otaBannerTrace";
import {
  OTA_DEBUG_UNAVAILABLE,
  safeDiagText,
  safeFormatCreatedAt,
  safeLogLines,
} from "./otaDebugGuards";
import { OTA_IDENTITY_FIX_VERSION } from "./otaUpdateIdentity";

export type OtaDebugSnapshot = {
  appVersion: string;
  buildNumber: string;
  /** CFBundleShortVersionString / expo.version / nativeAppVersion */
  cfBundleShortVersion: string;
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
  /** Whether NativeModules.RNPurchases is present on this binary (Case C signal). */
  hasRnPurchasesNative: boolean;
  /** Coach qualification/render pipeline marker (no network). */
  coachPipelineVersion: string;
};

export type OtaProbeResults = {
  checkResult: string;
  fetchResult: string;
  reloadResult: string;
  /** Parsed from checkResult when possible. */
  updateAvailable: boolean | null;
  fetchSucceeded: boolean | null;
  reloadSucceeded: boolean | null;
};

export type OtaFullDiagnostics = OtaDebugSnapshot &
  OtaProbeResults & {
    startupLogs: string[];
    jsLaunchLogs: string[];
    attestation: DeviceAttestationResult;
    expectedHealthy: {
      runtimeVersion: string;
      updateId: string;
      isEmbeddedLaunch: boolean;
    };
    caseCNativeSafety: string;
    /** Banner identity trace — proves why "App update ready" is visible. */
    bannerTrace: OtaBannerTraceSnapshot | null;
    bannerTraceLines: string[];
    /** Bundle marker; missing/absent ⇒ pre-identity-fix OTA. */
    otaIdentityFixVersion: number;
  };

function str(v: unknown, fallback = "—"): string {
  return safeDiagText(v, fallback);
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
  const Updates = tryGetExpoUpdates();
  if (!Updates) return OTA_DEBUG_UNAVAILABLE;
  try {
    const raw =
      (Updates as { createdAt?: Date | string | null }).createdAt ??
      (Updates.manifest as { createdAt?: string } | null | undefined)?.createdAt;
    return safeFormatCreatedAt(raw);
  } catch {
    return OTA_DEBUG_UNAVAILABLE;
  }
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
      cfBundleShortVersion: "—",
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
      hasRnPurchasesNative: false,
      coachPipelineVersion: COACH_PIPELINE_VERSION,
    };
  }
}

function readHasRnPurchasesNative(): boolean {
  try {
    // Lazy require so Node unit tests that import classify helpers stay clean.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules, Platform } = require("react-native") as typeof import("react-native");
    return Platform.OS !== "web" && !!NativeModules.RNPurchases;
  } catch {
    return false;
  }
}

function attestationFromSnapshot(snapshot: OtaDebugSnapshot): DeviceAttestationResult {
  return classifyDeviceAttestation({
    runtimeVersion: snapshot.runtimeVersion,
    updateId: snapshot.updateId,
    isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
    appVersion: snapshot.appVersion,
  });
}

/** Console + in-memory log of live device attestation values (read-only). */
export function logDeviceAttestation(snapshot: OtaDebugSnapshot): DeviceAttestationResult {
  const attestation = attestationFromSnapshot(snapshot);
  const lines = [
    "=== Stadium Edge device attestation ===",
    `Updates.runtimeVersion: ${snapshot.runtimeVersion}`,
    `Updates.updateId: ${snapshot.updateId}`,
    `Updates.isEmbeddedLaunch: ${snapshot.isEmbeddedLaunch}`,
    `app version / CFBundleShortVersionString: ${snapshot.cfBundleShortVersion}`,
    `native build number: ${snapshot.buildNumber}`,
    `update channel: ${snapshot.channel}`,
    `hasRnPurchasesNative: ${snapshot.hasRnPurchasesNative}`,
    `coachPipelineVersion: ${snapshot.coachPipelineVersion}`,
    ...expectedHealthyLines(),
    `case: ${attestation.caseId} — ${attestation.label}`,
    `summary: ${attestation.summary}`,
    `recovery: ${attestation.recoveryPath}`,
  ];
  if (attestation.caseId === "C") {
    lines.push(caseCNativeModuleSafetyReport());
  }
  const blob = lines.join("\n");
  console.log(blob);
  pushOtaLog("deviceAttestation", true, `${attestation.caseId}:${snapshot.runtimeVersion}:${snapshot.updateId}`);
  return attestation;
}

function parseProbeFlags(probe: {
  checkResult: string;
  fetchResult: string;
  reloadResult: string;
}): Pick<OtaProbeResults, "updateAvailable" | "fetchSucceeded" | "reloadSucceeded"> {
  let updateAvailable: boolean | null = null;
  const check = probe.checkResult;
  if (/isAvailable:\s*true|"isAvailable":\s*true/i.test(check)) updateAvailable = true;
  else if (/isAvailable:\s*false|"isAvailable":\s*false/i.test(check)) updateAvailable = false;
  else if (/^ERR:|timed out|skipped:/i.test(check)) updateAvailable = null;

  let fetchSucceeded: boolean | null = null;
  const fetch = probe.fetchResult;
  if (/success/i.test(fetch) && !/^ERR:/i.test(fetch)) fetchSucceeded = true;
  else if (/^ERR:|fail/i.test(fetch)) fetchSucceeded = false;
  else if (/skipped/i.test(fetch)) fetchSucceeded = null;

  let reloadSucceeded: boolean | null = null;
  const reload = probe.reloadResult;
  if (/invoked|reloaded|restart/i.test(reload) && !/^ERR:/i.test(reload)) reloadSucceeded = true;
  else if (/^ERR:|fail/i.test(reload)) reloadSucceeded = false;
  else if (/not invoked|skipped/i.test(reload)) reloadSucceeded = null;

  return { updateAvailable, fetchSucceeded, reloadSucceeded };
}

function readOtaDebugSnapshotUnsafe(): OtaDebugSnapshot {
  const { expo, updatesCfg } = readUpdatesConfig();
  const extra = expo?.extra as { eas?: { projectId?: string } } | undefined;
  const Updates = tryGetExpoUpdates();
  const loadErr = expoUpdatesLoadError();

  const channelHeader = updatesCfg?.requestHeaders?.["expo-channel-name"];
  const channel =
    str(Updates?.channel, "") ||
    str(channelHeader, "") ||
    (Updates ? "embedded-at-build (no channel header in app.json)" : OTA_DEBUG_UNAVAILABLE);

  const isEnabled = !!Updates?.isEnabled;
  const isEmbeddedLaunch = Updates ? !!Updates.isEmbeddedLaunch : true;
  const bundleSource: OtaDebugSnapshot["bundleSource"] = !Updates
    ? "unknown"
    : !isEnabled
      ? "unknown"
      : isEmbeddedLaunch
        ? "embedded"
        : "ota";

  const ctx = tryGetLatestContext() as {
    checkError?: unknown;
    downloadError?: unknown;
    isUpdatePending?: boolean;
    isDownloading?: boolean;
    isStartupProcedureRunning?: boolean;
    rollback?: { commitTime?: unknown };
  } | null;
  const checkErr = ctx?.checkError;
  const downloadErr = ctx?.downloadError;

  const appVersion = str(expo?.version ?? Constants.nativeAppVersion);
  const cfBundleShortVersion = str(
    Constants.nativeAppVersion ?? expo?.version,
    appVersion,
  );

  let requestHeaders = "— (none in embedded app.json)";
  try {
    requestHeaders = updatesCfg?.requestHeaders
      ? JSON.stringify(updatesCfg.requestHeaders)
      : requestHeaders;
  } catch (e) {
    requestHeaders = `ERR: ${e instanceof Error ? e.message : String(e)}`;
  }

  return {
    appVersion,
    buildNumber: str(Constants.nativeBuildVersion),
    cfBundleShortVersion,
    runtimeVersion: str(Updates?.runtimeVersion ?? expo?.runtimeVersion, OTA_DEBUG_UNAVAILABLE),
    channel,
    updateId: str(
      Updates?.updateId,
      isEmbeddedLaunch ? "embedded" : OTA_DEBUG_UNAVAILABLE,
    ),
    commitHash: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "not-baked",
    updateCreatedAt: formatCreatedAt(),
    bundleSource,
    updatesEnabled: isEnabled,
    isEmbeddedLaunch,
    isEmergencyLaunch: !!Updates?.isEmergencyLaunch,
    emergencyLaunchReason: str(Updates?.emergencyLaunchReason, "—"),
    checkAutomatically: str(
      Updates?.checkAutomatically ?? updatesCfg?.checkAutomatically,
      "ON_LOAD (native default)",
    ),
    fallbackToCacheTimeout: updatesCfg?.fallbackToCacheTimeout ?? 0,
    launchDurationMs:
      Updates?.launchDuration != null ? String(Updates.launchDuration) : "—",
    isUpdatePending: !!ctx?.isUpdatePending,
    isDownloading: !!ctx?.isDownloading,
    isStartupProcedureRunning: !!ctx?.isStartupProcedureRunning,
    rollbackCommitTime: str(ctx?.rollback?.commitTime, "—"),
    checkError: loadErr
      ? loadErr
      : checkErr
        ? checkErr instanceof Error
          ? checkErr.message
          : String(checkErr)
        : "—",
    downloadError: downloadErr
      ? downloadErr instanceof Error
        ? downloadErr.message
        : String(downloadErr)
      : "—",
    updateUrl: str(updatesCfg?.url),
    requestHeaders,
    projectId: str(extra?.eas?.projectId),
    deployMessage: process.env.EXPO_PUBLIC_DEPLOY_MESSAGE ?? "—",
    expectedCommit: process.env.EXPO_PUBLIC_GIT_COMMIT ?? "—",
    hasRnPurchasesNative: readHasRnPurchasesNative(),
    coachPipelineVersion: COACH_PIPELINE_VERSION,
  };
}

async function readStartupLogs(maxAgeMs = 3_600_000): Promise<string[]> {
  const Updates = tryGetExpoUpdates();
  if (!Updates) return [expoUpdatesLoadError() ?? "expo-updates unavailable"];
  if (__DEV__ || !Updates.isEnabled) return ["skipped: dev or Updates.isEnabled=false"];
  try {
    const entries = await withOtaTimeout(
      "readLogEntriesAsync",
      Updates.readLogEntriesAsync(maxAgeMs),
      8_000,
    );
    if (!Array.isArray(entries) || entries.length === 0) {
      return ["(no expo-updates log entries in last hour)"];
    }
    return entries.map((e) => {
      const ts = e?.timestamp ? safeFormatCreatedAt(new Date(e.timestamp)) : "?";
      const stack = Array.isArray(e?.stacktrace) && e.stacktrace.length
        ? ` | stack: ${e.stacktrace.slice(0, 2).map((s) => safeDiagText(s)).join(" → ")}`
        : "";
      return `${ts} [${safeDiagText(e?.level, "?")}] ${safeDiagText(e?.code, "?")}: ${safeDiagText(e?.message)}${stack}`;
    });
  } catch (e) {
    return [`readLogEntriesAsync ERR: ${e instanceof Error ? e.message : String(e)}`];
  }
}

/** Run check only — never fetch on the diagnostics screen (fetch without reload corrupts the in-memory bundle). */
export async function probeOtaCheckOnly(): Promise<OtaProbeResults> {
  const Updates = tryGetExpoUpdates();
  if (!Updates) {
    const base = {
      checkResult: `skipped: ${expoUpdatesLoadError()}`,
      fetchResult: "skipped (expo-updates unavailable)",
      reloadResult: "skipped",
    };
    return { ...base, ...parseProbeFlags(base) };
  }
  if (__DEV__ || !Updates.isEnabled) {
    const base = {
      checkResult: __DEV__ ? "skipped: __DEV__" : "skipped: Updates.isEnabled=false",
      fetchResult: "skipped (probe is check-only — use “Check, fetch & reload”)",
      reloadResult: "skipped (probe does not auto-reload)",
    };
    return { ...base, ...parseProbeFlags(base) };
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
    let manifestUpdateId: string | null = null;
    try {
      if (check?.manifest && typeof check.manifest === "object" && "id" in check.manifest) {
        const id = (check.manifest as { id?: unknown }).id;
        manifestUpdateId = id == null || id === "" ? null : String(id);
      }
    } catch {
      manifestUpdateId = null;
    }
    checkResult = JSON.stringify({
      isAvailable: !!check?.isAvailable,
      isRollBackToEmbedded: roll === true,
      reason: (check as { reason?: string } | null)?.reason ?? null,
      manifestUpdateId,
    });
    pushOtaLog("checkForUpdateAsync", true, checkResult);
  } catch (e) {
    checkResult = `ERR: ${e instanceof Error ? e.message : String(e)}`;
    pushOtaLog("checkForUpdateAsync", false, checkResult);
  }

  const base = { checkResult, fetchResult, reloadResult };
  return { ...base, ...parseProbeFlags(base) };
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
  const attestation = logDeviceAttestation(snapshot);
  const jsLaunchLogs = formatOtaLogLines();

  const emptyProbe = (partial: {
    checkResult: string;
    fetchResult: string;
    reloadResult: string;
  }): OtaProbeResults => ({ ...partial, ...parseProbeFlags(partial) });

  const probe = await Promise.race([
    probeOtaCheckOnly(),
    new Promise<OtaProbeResults>((resolve) =>
      setTimeout(
        () =>
          resolve(
            emptyProbe({
              checkResult: `timeout after ${timeoutMs}ms`,
              fetchResult: "skipped (probe timeout)",
              reloadResult: "skipped (probe timeout)",
            }),
          ),
        timeoutMs,
      ),
    ),
  ]).catch(
    (): OtaProbeResults =>
      emptyProbe({
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

  let availableUpdateIdFromCheck: string | null = null;
  try {
    const parsed = JSON.parse(probe.checkResult) as {
      manifestUpdateId?: string | null;
    };
    if (parsed?.manifestUpdateId) {
      availableUpdateIdFromCheck = String(parsed.manifestUpdateId);
    }
  } catch {
    // checkResult may be ERR:/skipped
  }

  let bannerTrace: OtaBannerTraceSnapshot | null = null;
  try {
    bannerTrace = await collectOtaBannerTrace({
      availableUpdateIdFromCheck,
      checkResult: probe.checkResult,
    });
  } catch (e) {
    pushOtaLog(
      "checkForUpdateAsync",
      false,
      `bannerTrace ERR: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const bannerTraceLines = safeLogLines(
    bannerTrace ? formatOtaBannerTraceLines(bannerTrace) : null,
    "bannerTrace unavailable",
  );

  try {
    console.log(
      [
        "=== OTA probe outcomes ===",
        `OTA_IDENTITY_FIX_VERSION: ${OTA_IDENTITY_FIX_VERSION}`,
        `update check available: ${String(probe.updateAvailable)}`,
        `checkResult: ${probe.checkResult}`,
        `fetchSucceeded: ${String(probe.fetchSucceeded)} (${probe.fetchResult})`,
        `reloadSucceeded: ${String(probe.reloadSucceeded)} (${probe.reloadResult})`,
        ...bannerTraceLines,
      ].join("\n"),
    );
  } catch {
    // Diagnostics must never crash the app via console formatting.
  }

  return {
    ...snapshot,
    ...probe,
    startupLogs: safeLogLines(startupLogs, "startup logs unavailable"),
    jsLaunchLogs: safeLogLines(jsLaunchLogs, "(none)"),
    attestation,
    expectedHealthy: {
      runtimeVersion: EXPECTED_HEALTHY_RUNTIME,
      updateId: EXPECTED_HEALTHY_UPDATE_ID,
      isEmbeddedLaunch: EXPECTED_HEALTHY_EMBEDDED,
    },
    caseCNativeSafety: caseCNativeModuleSafetyReport(),
    bannerTrace,
    bannerTraceLines,
    otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
  };
}

export type OtaCheckResult = {
  downloaded: boolean;
  reloaded: boolean;
  reason?: string;
  checkResult?: string;
  fetchResult?: string;
  reloadResult?: string;
  updateAvailable?: boolean | null;
  fetchSucceeded?: boolean | null;
  reloadSucceeded?: boolean | null;
};

/**
 * Check, fetch, and reload via expo-updates only — never reset React error
 * boundaries (that reopens the same in-memory JS bundle).
 */
export async function forceOtaCheckFetchAndReload(): Promise<OtaCheckResult> {
  const Updates = tryGetExpoUpdates();
  if (!Updates || __DEV__ || !Updates.isEnabled) {
    pushOtaLog("checkForUpdateAsync", false, "manual: dev or Updates disabled");
    return {
      downloaded: false,
      reloaded: false,
      reason: Updates
        ? "Updates disabled (dev build or expo-updates off)"
        : expoUpdatesLoadError() ?? "expo-updates unavailable",
      checkResult: "skipped",
      fetchResult: "skipped",
      reloadResult: "skipped",
      updateAvailable: null,
      fetchSucceeded: null,
      reloadSucceeded: null,
    };
  }

  // Run a check-only probe first so the UI can show availability even when
  // launchOtaCheckFetchReload returns idle (no newer update).
  // Dynamic import keeps otaLaunch's static expo-updates graph off the
  // /ota-debug module-eval path (deep-link cold start).
  const preCheck = await probeOtaCheckOnly();
  const { launchOtaCheckFetchReload } = await import("./otaLaunch");
  const outcome = await launchOtaCheckFetchReload();
  const logs = formatOtaLogLines();
  const fetchLog = [...logs].reverse().find((l) => /fetchUpdateAsync/i.test(l));
  const reloadLog = [...logs].reverse().find((l) => /reloadAsync/i.test(l));

  if (outcome === "reloaded") {
    const result: OtaCheckResult = {
      downloaded: true,
      reloaded: true,
      checkResult: preCheck.checkResult,
      fetchResult: fetchLog ?? "success (reload followed fetch)",
      reloadResult: "reloadAsync invoked (app should restart)",
      updateAvailable: preCheck.updateAvailable ?? true,
      fetchSucceeded: true,
      reloadSucceeded: true,
    };
    console.log("=== OTA check/fetch/reload ===", JSON.stringify(result));
    return result;
  }

  const fetchFailed = fetchLog != null && /fail|ERR/i.test(fetchLog);
  const reloadFailed = reloadLog != null && /fail|ERR/i.test(reloadLog);
  const result: OtaCheckResult = {
    downloaded: false,
    reloaded: false,
    reason: fetchFailed
      ? `fetch failed: ${fetchLog}`
      : reloadFailed
        ? `reload failed: ${reloadLog}`
        : "Server reports no newer update for this runtime/channel",
    checkResult: preCheck.checkResult,
    fetchResult:
      fetchLog ??
      (preCheck.updateAvailable === false
        ? "not attempted (no update available)"
        : preCheck.fetchResult),
    reloadResult:
      reloadLog ?? "not invoked (no update available or pending)",
    updateAvailable: preCheck.updateAvailable,
    fetchSucceeded: fetchFailed ? false : fetchLog ? true : null,
    reloadSucceeded: reloadFailed ? false : null,
  };
  console.log("=== OTA check/fetch/reload ===", JSON.stringify(result));
  return result;
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
