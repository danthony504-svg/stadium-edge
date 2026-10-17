import Constants from "expo-constants";

import {
  EXPECTED_HEALTHY_EMBEDDED,
  EXPECTED_HEALTHY_RUNTIME,
  caseCNativeModuleSafetyReport,
  classifyDeviceAttestation,
  expectedHealthyLines,
  formatChannelTipMatchLabel,
  formatOtaChannelStreamLabel,
  resolveKnownChannelTipUpdateId,
  type DeviceAttestationResult,
} from "./otaDeviceAttestation";
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
import { diagnoseEmbeddedApplyState } from "./otaEmbeddedApplyDiagnosis";
import {
  canRunLiveOtaProbe,
  LIVE_PROBE_STARTUP_WAIT_MESSAGE,
  OTA_DEBUG_IDLE_CHECK_RESULT,
} from "./otaDebugOpenPolicy";
import {
  OTA_FAILED_LAUNCH_KEY,
  readFailedLaunchRecord,
  type OtaFailedLaunchRecord,
} from "./otaFailedLaunch";
import { readOtaRecoverySnapshot } from "./otaRecoveryState";
import { OTA_IDENTITY_FIX_VERSION } from "./otaUpdateIdentity";

/**
 * Diagnostics-only mirror of coach COACH_PIPELINE_VERSION.
 * Must NOT import qualifyCoachCandidate — that pulls the sim graph into Home
 * via OtaHomeDiagnostics and has blacklisted OTA tips (updatePreviouslyFailed).
 */
const COACH_PIPELINE_VERSION_DIAG = "unified-quality-v1";

export { diagnoseEmbeddedApplyState } from "./otaEmbeddedApplyDiagnosis";
export { canRunLiveOtaProbe, LIVE_PROBE_STARTUP_WAIT_MESSAGE, OTA_DEBUG_IDLE_CHECK_RESULT };

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
  /** latestContext.downloadedManifest.id (no network). */
  downloadedUpdateIdFromContext: string;
  /** latestContext.latestManifest.id (no network). */
  availableUpdateIdFromContext: string;
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
      isEmbeddedLaunch: boolean;
      /** Known channel tip when probed; empty when unknown — never a hardcoded historical id. */
      channelTipUpdateId: string;
      channelStreamLabel: string;
      tipMatchLabel: string;
    };
    caseCNativeSafety: string;
    /** Banner identity trace — proves why "App update ready" is visible. */
    bannerTrace: OtaBannerTraceSnapshot | null;
    bannerTraceLines: string[];
    /** Bundle marker; missing/absent ⇒ pre-identity-fix OTA. */
    otaIdentityFixVersion: number;
    /** Persisted @stadium/ota-failed-launch ledger (JS-side). */
    failedLaunchLedgerLines: string[];
    /** Human diagnosis of why embedded may still be running. */
    applyDiagnosis: string;
    /** true when live checkForUpdateAsync has been run this session. */
    liveProbeRan: boolean;
  };

const IDLE_PROBE: OtaProbeResults = {
  checkResult: OTA_DEBUG_IDLE_CHECK_RESULT,
  fetchResult: "not run (live probe is check-only)",
  reloadResult: "not run",
  updateAvailable: null,
  fetchSucceeded: null,
  reloadSucceeded: null,
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
      coachPipelineVersion: COACH_PIPELINE_VERSION_DIAG,
      downloadedUpdateIdFromContext: OTA_DEBUG_UNAVAILABLE,
      availableUpdateIdFromContext: OTA_DEBUG_UNAVAILABLE,
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

function channelTipFromSnapshot(
  snapshot: OtaDebugSnapshot,
  opts?: { updateAvailable?: boolean | null; availableUpdateIdFromCheck?: string | null },
): string | null {
  return resolveKnownChannelTipUpdateId({
    availableUpdateIdFromContext: snapshot.availableUpdateIdFromContext,
    availableUpdateIdFromCheck: opts?.availableUpdateIdFromCheck,
    runningUpdateId: snapshot.updateId,
    updateAvailable: opts?.updateAvailable,
    isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
  });
}

function attestationFromSnapshot(
  snapshot: OtaDebugSnapshot,
  opts?: { updateAvailable?: boolean | null; availableUpdateIdFromCheck?: string | null },
): DeviceAttestationResult {
  const channelTipUpdateId = channelTipFromSnapshot(snapshot, opts);
  return classifyDeviceAttestation({
    runtimeVersion: snapshot.runtimeVersion,
    updateId: snapshot.updateId,
    isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
    appVersion: snapshot.appVersion,
    channel: snapshot.channel,
    channelTipUpdateId,
  });
}

function expectedHealthyFromSnapshot(
  snapshot: OtaDebugSnapshot,
  attestation: DeviceAttestationResult,
  opts?: { updateAvailable?: boolean | null; availableUpdateIdFromCheck?: string | null },
): OtaFullDiagnostics["expectedHealthy"] {
  const tip = channelTipFromSnapshot(snapshot, opts);
  return {
    runtimeVersion: EXPECTED_HEALTHY_RUNTIME,
    isEmbeddedLaunch: EXPECTED_HEALTHY_EMBEDDED,
    channelTipUpdateId: tip ?? "",
    channelStreamLabel: formatOtaChannelStreamLabel(snapshot.channel),
    tipMatchLabel: formatChannelTipMatchLabel(attestation.matchesChannelTip),
  };
}

/** Console + in-memory log of live device attestation values (read-only). */
export function logDeviceAttestation(snapshot: OtaDebugSnapshot): DeviceAttestationResult {
  const attestation = attestationFromSnapshot(snapshot);
  const tip = channelTipFromSnapshot(snapshot);
  const lines = [
    "=== Stadium Edge device attestation ===",
    `channel stream: ${formatOtaChannelStreamLabel(snapshot.channel)}`,
    `Updates.runtimeVersion: ${snapshot.runtimeVersion}`,
    `Updates.updateId: ${snapshot.updateId}`,
    `Updates.isEmbeddedLaunch: ${snapshot.isEmbeddedLaunch}`,
    `app version / CFBundleShortVersionString: ${snapshot.cfBundleShortVersion}`,
    `native build number: ${snapshot.buildNumber}`,
    `update channel: ${snapshot.channel}`,
    `hasRnPurchasesNative: ${snapshot.hasRnPurchasesNative}`,
    `coachPipelineVersion: ${snapshot.coachPipelineVersion}`,
    ...expectedHealthyLines({
      channel: snapshot.channel,
      channelTipUpdateId: tip,
    }),
    `equals channel tip: ${formatChannelTipMatchLabel(attestation.matchesChannelTip)}`,
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
    downloadedManifest?: { id?: unknown } | null;
    latestManifest?: { id?: unknown } | null;
  } | null;
  const checkErr = ctx?.checkError;
  const downloadErr = ctx?.downloadError;
  const downloadedFromCtx = (() => {
    try {
      const id = ctx?.downloadedManifest?.id;
      return id == null || id === "" ? OTA_DEBUG_UNAVAILABLE : String(id);
    } catch {
      return OTA_DEBUG_UNAVAILABLE;
    }
  })();
  const availableFromCtx = (() => {
    try {
      const id = ctx?.latestManifest?.id;
      return id == null || id === "" ? OTA_DEBUG_UNAVAILABLE : String(id);
    } catch {
      return OTA_DEBUG_UNAVAILABLE;
    }
  })();

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
    coachPipelineVersion: COACH_PIPELINE_VERSION_DIAG,
    downloadedUpdateIdFromContext: downloadedFromCtx,
    availableUpdateIdFromContext: availableFromCtx,
  };
}

async function readFailedLaunchLedgerLines(): Promise<{
  lines: string[];
  record: OtaFailedLaunchRecord;
}> {
  try {
    // Lazy require so node:test that only imports classify helpers stays clean.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require("@react-native-async-storage/async-storage").default as {
      getItem: (key: string) => Promise<string | null>;
    };
    const record = await readFailedLaunchRecord({
      read: () => AsyncStorage.getItem(OTA_FAILED_LAUNCH_KEY),
    });
    const entries = Object.entries(record.failures ?? {});
    const out: string[] = [
      `pendingTargetId: ${record.pendingTargetId ?? "—"}`,
      `pendingTargetAt: ${
        record.pendingTargetAt ? new Date(record.pendingTargetAt).toISOString() : "—"
      }`,
    ];
    if (entries.length === 0) out.push("(no failed-launch entries)");
    else {
      for (const [id, e] of entries) {
        out.push(
          `failed ${id}: count=${e.count} lastAt=${
            e.lastAt ? new Date(e.lastAt).toISOString() : "—"
          }`,
        );
      }
    }
    return { lines: out, record };
  } catch (e) {
    return {
      lines: [
        `failed-launch ledger ERR: ${e instanceof Error ? e.message : String(e)}`,
      ],
      record: { pendingTargetId: null, pendingTargetAt: null, failures: {} },
    };
  }
}

async function readStartupLogs(maxAgeMs = 3_600_000): Promise<string[]> {
  const Updates = tryGetExpoUpdates();
  if (!Updates) return [expoUpdatesLoadError() ?? "expo-updates unavailable"];
  if (__DEV__ || !Updates.isEnabled) return ["skipped: dev or Updates.isEnabled=false"];
  // Native log read during startup procedure has crashed physical devices.
  // Static /ota-debug open must not touch Updates APIs while startup runs.
  try {
    const ctx = tryGetLatestContext() as { isStartupProcedureRunning?: boolean } | null;
    if (ctx?.isStartupProcedureRunning) {
      return ["skipped: isStartupProcedureRunning=true (no Updates I/O on open)"];
    }
  } catch {
    // continue — best-effort gate
  }
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

  // Hard gate: never call checkForUpdateAsync while startup is running.
  try {
    const ctx = tryGetLatestContext() as { isStartupProcedureRunning?: boolean } | null;
    if (!canRunLiveOtaProbe(!!ctx?.isStartupProcedureRunning)) {
      const base = {
        checkResult: `skipped: ${LIVE_PROBE_STARTUP_WAIT_MESSAGE}`,
        fetchResult: "skipped (startup running)",
        reloadResult: "skipped (startup running)",
      };
      return { ...base, ...parseProbeFlags(base) };
    }
  } catch {
    // continue
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

function buildDiagnosticsShell(
  snapshot: OtaDebugSnapshot,
  extras: {
    probe: OtaProbeResults;
    startupLogs: string[];
    jsLaunchLogs: string[];
    bannerTrace: OtaBannerTraceSnapshot | null;
    bannerTraceLines: string[];
    failedLaunchLedgerLines: string[];
    applyDiagnosis: string;
    liveProbeRan: boolean;
    attestation: DeviceAttestationResult;
  },
): OtaFullDiagnostics {
  return {
    ...snapshot,
    ...extras.probe,
    startupLogs: safeLogLines(extras.startupLogs, "startup logs unavailable"),
    jsLaunchLogs: safeLogLines(extras.jsLaunchLogs, "(none)"),
    attestation: extras.attestation,
    expectedHealthy: expectedHealthyFromSnapshot(snapshot, extras.attestation, {
      updateAvailable: extras.probe.updateAvailable,
    }),
    caseCNativeSafety: caseCNativeModuleSafetyReport(),
    bannerTrace: extras.bannerTrace,
    bannerTraceLines: safeLogLines(extras.bannerTraceLines, "bannerTrace unavailable"),
    otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
    failedLaunchLedgerLines: safeLogLines(
      extras.failedLaunchLedgerLines,
      "(no failed-launch entries)",
    ),
    applyDiagnosis: extras.applyDiagnosis,
    liveProbeRan: extras.liveProbeRan,
  };
}

/**
 * Static-only diagnostics — NO checkForUpdateAsync / fetch / reload.
 * Safe for /ota-debug initial render and deep-link cold launch.
 * Never throws — failures are folded into the returned diagnostics object.
 */
export async function collectOtaStaticDiagnostics(): Promise<OtaFullDiagnostics> {
  try {
    const snapshot = readOtaDebugSnapshot();
    const attestation = logDeviceAttestation(snapshot);
    const jsLaunchLogs = formatOtaLogLines();

    let startupLogs: string[] = ["loading…"];
    try {
      startupLogs = await readStartupLogs();
    } catch (e) {
      startupLogs = [`readLogEntriesAsync ERR: ${e instanceof Error ? e.message : String(e)}`];
    }

    const { lines: failedLaunchLedgerLines, record: failedLaunchRecord } =
      await readFailedLaunchLedgerLines();

    let recoveryPending = false;
    let recoveryReloadTargetId = "—";
    try {
      const recovery = readOtaRecoverySnapshot();
      recoveryPending = !!recovery.pending;
      recoveryReloadTargetId = recovery.reloadTargetId;
    } catch {
      // ignore
    }

    let bannerTrace: OtaBannerTraceSnapshot | null = null;
    try {
      // Persisted ready id + context only — no live check result.
      bannerTrace = await collectOtaBannerTrace({
        availableUpdateIdFromCheck: null,
        checkResult: IDLE_PROBE.checkResult,
      });
    } catch (e) {
      console.warn(
        `[ota-debug] bannerTrace ERR: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const applyDiagnosis = diagnoseEmbeddedApplyState({
      isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
      isEmergencyLaunch: snapshot.isEmergencyLaunch,
      emergencyLaunchReason: snapshot.emergencyLaunchReason,
      isUpdatePending: snapshot.isUpdatePending,
      isStartupProcedureRunning: snapshot.isStartupProcedureRunning,
      runningUpdateId: snapshot.updateId,
      downloadedUpdateIdFromContext: snapshot.downloadedUpdateIdFromContext,
      availableUpdateIdFromContext: snapshot.availableUpdateIdFromContext,
      fallbackToCacheTimeout: snapshot.fallbackToCacheTimeout,
      failedLaunchRecord,
      recoveryPending,
      recoveryReloadTargetId,
    });

    try {
      console.log(
        [
          "=== OTA static diagnostics (no live probe) ===",
          `OTA_IDENTITY_FIX_VERSION: ${OTA_IDENTITY_FIX_VERSION}`,
          `isEmbeddedLaunch: ${snapshot.isEmbeddedLaunch}`,
          `updateId: ${snapshot.updateId}`,
          `downloadedUpdateIdFromContext: ${snapshot.downloadedUpdateIdFromContext}`,
          `isStartupProcedureRunning: ${snapshot.isStartupProcedureRunning}`,
          applyDiagnosis,
          ...failedLaunchLedgerLines,
        ].join("\n"),
      );
    } catch {
      // ignore
    }

    return buildDiagnosticsShell(snapshot, {
      probe: IDLE_PROBE,
      startupLogs,
      jsLaunchLogs,
      bannerTrace,
      bannerTraceLines: bannerTrace
        ? formatOtaBannerTraceLines(bannerTrace)
        : ["bannerTrace unavailable"],
      failedLaunchLedgerLines,
      applyDiagnosis,
      liveProbeRan: false,
      attestation,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const snapshot = readOtaDebugSnapshot();
    return buildDiagnosticsShell(snapshot, {
      probe: {
        ...IDLE_PROBE,
        checkResult: OTA_DEBUG_IDLE_CHECK_RESULT,
      },
      startupLogs: [`collectOtaStaticDiagnostics ERR: ${msg}`],
      jsLaunchLogs: formatOtaLogLines(),
      bannerTrace: null,
      bannerTraceLines: [`bannerTrace unavailable: ${msg}`],
      failedLaunchLedgerLines: [`ledger unavailable: ${msg}`],
      applyDiagnosis: `static diagnostics ERR: ${msg}`,
      liveProbeRan: false,
      attestation: attestationFromSnapshot(snapshot),
    });
  }
}

/**
 * Manual live probe — checkForUpdateAsync only (no fetch/reload).
 * Must be user-initiated from /ota-debug so opening diagnostics cannot crash
 * during/after network probe.
 */
export async function collectOtaLiveProbeDiagnostics(
  timeoutMs = OTA_NETWORK_TIMEOUT_MS,
): Promise<OtaFullDiagnostics> {
  const base = await collectOtaStaticDiagnostics();

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

  let bannerTrace: OtaBannerTraceSnapshot | null = base.bannerTrace;
  try {
    bannerTrace = await collectOtaBannerTrace({
      availableUpdateIdFromCheck,
      checkResult: probe.checkResult,
    });
  } catch (e) {
    console.warn(
      `[ota-debug] live bannerTrace ERR: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const bannerTraceLines = safeLogLines(
    bannerTrace ? formatOtaBannerTraceLines(bannerTrace) : null,
    "bannerTrace unavailable",
  );

  const tipOpts = {
    updateAvailable: probe.updateAvailable,
    availableUpdateIdFromCheck,
  };
  const attestation = attestationFromSnapshot(base, tipOpts);
  const expectedHealthy = expectedHealthyFromSnapshot(base, attestation, tipOpts);

  try {
    console.log(
      [
        "=== OTA live probe outcomes ===",
        `OTA_IDENTITY_FIX_VERSION: ${OTA_IDENTITY_FIX_VERSION}`,
        `channel stream: ${expectedHealthy.channelStreamLabel}`,
        `update check available: ${String(probe.updateAvailable)}`,
        `checkResult: ${probe.checkResult}`,
        `equals channel tip: ${expectedHealthy.tipMatchLabel}`,
        ...bannerTraceLines,
      ].join("\n"),
    );
  } catch {
    // ignore
  }

  return {
    ...base,
    ...probe,
    attestation,
    expectedHealthy,
    bannerTrace,
    bannerTraceLines,
    liveProbeRan: true,
  };
}

/**
 * @deprecated Prefer collectOtaStaticDiagnostics on open + collectOtaLiveProbeDiagnostics
 * behind a button. Kept for callers that still want the combined path.
 */
export async function collectOtaFullDiagnostics(
  timeoutMs = OTA_NETWORK_TIMEOUT_MS,
): Promise<OtaFullDiagnostics> {
  return collectOtaLiveProbeDiagnostics(timeoutMs);
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

  try {
    const ctx = tryGetLatestContext() as { isStartupProcedureRunning?: boolean } | null;
    if (!canRunLiveOtaProbe(!!ctx?.isStartupProcedureRunning)) {
      return {
        downloaded: false,
        reloaded: false,
        reason: LIVE_PROBE_STARTUP_WAIT_MESSAGE,
        checkResult: `skipped: ${LIVE_PROBE_STARTUP_WAIT_MESSAGE}`,
        fetchResult: "skipped (startup running)",
        reloadResult: "skipped (startup running)",
        updateAvailable: null,
        fetchSucceeded: null,
        reloadSucceeded: null,
      };
    }
  } catch {
    // continue
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
