/**
 * Read-only OTA banner identity trace — does not change apply/reload behavior.
 *
 * Captures the exact inputs to the banner visibility expression so a physical
 * device can prove why "App update ready" is showing.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { tryGetExpoUpdates, tryGetLatestContext } from "./expoUpdatesAccess.ts";
import {
  OTA_DEBUG_UNAVAILABLE,
  safeDiagText,
  safeFormatCreatedAt,
  safeLogLines,
} from "./otaDebugGuards.ts";
import {
  isGenuinelyPendingOtaUpdate,
  normalizeOtaUpdateId,
  OTA_IDENTITY_FIX_VERSION,
  OTA_READY_FLAG_KEY,
  parseOtaReadyFlag,
} from "./otaUpdateIdentity.ts";
import { readOtaRecoverySnapshot } from "./otaRecoveryState.ts";

/** Ring buffer of recent banner-decision snapshots (newest last). */
const TRACE_CAP = 24;
let traces: OtaBannerTraceSnapshot[] = [];

export type OtaBannerTraceSnapshot = {
  at: string;
  /** Proves this JS bundle includes the identity-fix marker (not app/runtime version). */
  otaIdentityFixVersion: number;
  runningUpdateId: string | null;
  isEmbeddedLaunch: boolean;
  createdAt: string;
  runtimeVersion: string;
  channel: string;
  downloadedUpdateId: string | null;
  availableUpdateIdFromContext: string | null;
  /** From last checkForUpdateAsync when diagnostics ran (may be "—"). */
  availableUpdateIdFromCheck: string | null;
  checkResult: string | null;
  persistedReadyId: string | null;
  nativeIsUpdatePending: boolean;
  nativeIsDownloading: boolean;
  /**
   * Exact expression used by OtaUpdateBanner:
   *   genuinelyPending = isGenuinelyPendingOtaUpdate({ running, downloaded, nativePending })
   *   bannerVisible = genuinelyPending || nativeIsDownloading
   */
  genuinelyPending: boolean;
  bannerVisible: boolean;
  bannerExpression: string;
  /** Session / recovery paths that can arm pending independently of the banner. */
  recoveryPending: boolean;
  recoveryReloadTargetId: string;
  sessionNotes: string[];
};

function strId(v: unknown): string | null {
  try {
    return normalizeOtaUpdateId(typeof v === "string" ? v : v == null ? null : String(v));
  } catch {
    return null;
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

function channelName(): string {
  const Updates = tryGetExpoUpdates();
  if (!Updates) return OTA_DEBUG_UNAVAILABLE;
  try {
    return Updates.channel ? String(Updates.channel) : "—";
  } catch {
    return OTA_DEBUG_UNAVAILABLE;
  }
}

function downloadedIdFromContext(ctx: unknown): string | null {
  try {
    const id = (ctx as { downloadedManifest?: { id?: string } | null } | null | undefined)
      ?.downloadedManifest?.id;
    return strId(id);
  } catch {
    return null;
  }
}

function availableIdFromContext(ctx: unknown): string | null {
  try {
    const id = (ctx as { latestManifest?: { id?: string } | null } | null | undefined)
      ?.latestManifest?.id;
    return strId(id);
  } catch {
    return null;
  }
}

export function readOtaBannerTraceSync(opts?: {
  availableUpdateIdFromCheck?: string | null;
  checkResult?: string | null;
  persistedReadyId?: string | null;
}): OtaBannerTraceSnapshot {
  const Updates = tryGetExpoUpdates();
  const ctx = tryGetLatestContext() as {
    isUpdatePending?: boolean;
    isDownloading?: boolean;
    downloadedManifest?: { id?: string } | null;
    latestManifest?: { id?: string } | null;
  } | null;

  const runningUpdateId = strId(Updates?.updateId);
  const downloadedUpdateId = downloadedIdFromContext(ctx);
  const availableUpdateIdFromContext = availableIdFromContext(ctx);
  const nativeIsUpdatePending = !!ctx?.isUpdatePending;
  const nativeIsDownloading = !!ctx?.isDownloading;

  const genuinelyPending = isGenuinelyPendingOtaUpdate({
    runningUpdateId,
    downloadedUpdateId,
    availableUpdateId:
      opts?.availableUpdateIdFromCheck ?? availableUpdateIdFromContext,
    isUpdatePending: nativeIsUpdatePending,
  });
  // Mirror OtaUpdateBanner render gate exactly (do not change it here).
  const bannerVisible = genuinelyPending || nativeIsDownloading;

  let recovery = {
    pending: false,
    reloadTargetId: "—",
  };
  try {
    recovery = readOtaRecoverySnapshot();
  } catch {
    // unhydrated recovery store must not crash diagnostics
  }

  const sessionNotes: string[] = [];
  if (!Updates) {
    sessionNotes.push("expo-updates unavailable — banner trace using null fallbacks");
  }
  if (ctx == null) {
    sessionNotes.push("latestContext not hydrated yet");
  }
  if (recovery.pending) {
    sessionNotes.push(
      `otaRecoveryState.pending=true reloadTarget=${safeDiagText(recovery.reloadTargetId)}`,
    );
  }
  if (nativeIsUpdatePending && !genuinelyPending) {
    sessionNotes.push(
      "native isUpdatePending=true but identity gate cleared (same id as running)",
    );
  }
  if (nativeIsUpdatePending && !downloadedUpdateId) {
    sessionNotes.push(
      "HOLE: native pending=true but downloadedManifest.id missing — banner falls through to native pending",
    );
  }
  if (nativeIsDownloading && !genuinelyPending) {
    sessionNotes.push("banner visible only via isDownloading (not ready state)");
  }

  const bannerExpression =
    `bannerVisible = isGenuinelyPendingOtaUpdate({` +
    `running=${runningUpdateId ?? "null"},` +
    `downloaded=${downloadedUpdateId ?? "null"},` +
    `available=${opts?.availableUpdateIdFromCheck ?? availableUpdateIdFromContext ?? "null"},` +
    `nativePending=${nativeIsUpdatePending}` +
    `}) || isDownloading(${nativeIsDownloading})` +
    ` => ${bannerVisible}`;

  return {
    at: new Date().toISOString(),
    otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
    runningUpdateId,
    isEmbeddedLaunch: Updates ? !!Updates.isEmbeddedLaunch : true,
    createdAt: formatCreatedAt(),
    runtimeVersion: safeDiagText(Updates?.runtimeVersion, "—"),
    channel: channelName(),
    downloadedUpdateId,
    availableUpdateIdFromContext,
    availableUpdateIdFromCheck: opts?.availableUpdateIdFromCheck ?? null,
    checkResult: opts?.checkResult ?? null,
    persistedReadyId: opts?.persistedReadyId ?? null,
    nativeIsUpdatePending,
    nativeIsDownloading,
    genuinelyPending,
    bannerVisible,
    bannerExpression,
    recoveryPending: !!recovery.pending,
    recoveryReloadTargetId: safeDiagText(recovery.reloadTargetId, "—"),
    sessionNotes,
  };
}

/** Record a snapshot (banner mount / context change / diagnostics). */
export function recordOtaBannerTrace(
  opts?: Parameters<typeof readOtaBannerTraceSync>[0],
): OtaBannerTraceSnapshot {
  const snap = readOtaBannerTraceSync(opts);
  traces = [...traces.slice(-(TRACE_CAP - 1)), snap];
  console.log(
    [
      "=== OTA banner identity trace ===",
      `OTA_IDENTITY_FIX_VERSION=${snap.otaIdentityFixVersion}`,
      `runningUpdateId=${snap.runningUpdateId}`,
      `isEmbeddedLaunch=${snap.isEmbeddedLaunch}`,
      `createdAt=${snap.createdAt}`,
      `runtimeVersion=${snap.runtimeVersion}`,
      `channel=${snap.channel}`,
      `downloadedUpdateId=${snap.downloadedUpdateId}`,
      `availableUpdateId(context)=${snap.availableUpdateIdFromContext}`,
      `availableUpdateId(check)=${snap.availableUpdateIdFromCheck}`,
      `persistedReadyId=${snap.persistedReadyId}`,
      `nativeIsUpdatePending=${snap.nativeIsUpdatePending}`,
      `nativeIsDownloading=${snap.nativeIsDownloading}`,
      `genuinelyPending=${snap.genuinelyPending}`,
      `bannerVisible=${snap.bannerVisible}`,
      `recoveryPending=${snap.recoveryPending} target=${snap.recoveryReloadTargetId}`,
      snap.bannerExpression,
      ...safeLogLines(snap.sessionNotes, "").filter(Boolean).map((n) => `note: ${n}`),
    ].join("\n"),
  );
  // Do not pushOtaLog under checkForUpdateAsync — that made /ota-debug JS logs
  // look like an automatic live probe on open.
  return snap;
}

export function readOtaBannerTraceHistory(): OtaBannerTraceSnapshot[] {
  return [...traces];
}

export async function readPersistedOtaReadyId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(OTA_READY_FLAG_KEY);
    return parseOtaReadyFlag(raw)?.readyUpdateId ?? null;
  } catch {
    return null;
  }
}

/** Full async trace: persisted ready flag + optional check result fields. */
export async function collectOtaBannerTrace(opts?: {
  availableUpdateIdFromCheck?: string | null;
  checkResult?: string | null;
}): Promise<OtaBannerTraceSnapshot> {
  const persistedReadyId = await readPersistedOtaReadyId();
  return recordOtaBannerTrace({
    availableUpdateIdFromCheck: opts?.availableUpdateIdFromCheck ?? null,
    checkResult: opts?.checkResult ?? null,
    persistedReadyId,
  });
}

export function formatOtaBannerTraceLines(snap: OtaBannerTraceSnapshot | null | undefined): string[] {
  if (!snap) return ["bannerTrace unavailable"];
  const notes = safeLogLines(snap.sessionNotes, "").filter(Boolean);
  return [
    `OTA_IDENTITY_FIX_VERSION: ${safeDiagText(snap.otaIdentityFixVersion)}`,
    `at: ${safeDiagText(snap.at)}`,
    `Updates.updateId (running): ${snap.runningUpdateId ?? "—"}`,
    `Updates.isEmbeddedLaunch: ${safeDiagText(snap.isEmbeddedLaunch)}`,
    `Updates.createdAt: ${safeDiagText(snap.createdAt)}`,
    `runtimeVersion: ${safeDiagText(snap.runtimeVersion)}`,
    `channel: ${safeDiagText(snap.channel)}`,
    `downloadedManifest.id: ${snap.downloadedUpdateId ?? "—"}`,
    `latestManifest.id: ${snap.availableUpdateIdFromContext ?? "—"}`,
    `check availableUpdateId: ${snap.availableUpdateIdFromCheck ?? "—"}`,
    `checkResult: ${snap.checkResult ?? "—"}`,
    `persisted @stadium/ota-update-ready: ${snap.persistedReadyId ?? "—"}`,
    `latestContext.isUpdatePending: ${safeDiagText(snap.nativeIsUpdatePending)}`,
    `latestContext.isDownloading: ${safeDiagText(snap.nativeIsDownloading)}`,
    `genuinelyPending: ${safeDiagText(snap.genuinelyPending)}`,
    `bannerVisible: ${safeDiagText(snap.bannerVisible)}`,
    `bannerExpression: ${safeDiagText(snap.bannerExpression)}`,
    `recovery.pending: ${safeDiagText(snap.recoveryPending)}`,
    `recovery.reloadTargetId: ${safeDiagText(snap.recoveryReloadTargetId)}`,
    ...notes.map((n) => `note: ${n}`),
  ];
}
