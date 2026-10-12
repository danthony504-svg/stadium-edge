/**
 * Read-only OTA banner identity trace — does not change apply/reload behavior.
 *
 * Captures the exact inputs to the banner visibility expression so a physical
 * device can prove why "App update ready" is showing.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { latestContext } from "expo-updates";

import {
  isGenuinelyPendingOtaUpdate,
  normalizeOtaUpdateId,
  OTA_IDENTITY_FIX_VERSION,
  OTA_READY_FLAG_KEY,
  parseOtaReadyFlag,
} from "./otaUpdateIdentity.ts";
import { readOtaRecoverySnapshot } from "./otaRecoveryState.ts";
import { pushOtaLog } from "./otaLaunchLog.ts";

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
  return normalizeOtaUpdateId(typeof v === "string" ? v : v == null ? null : String(v));
}

function formatCreatedAt(): string {
  const raw =
    (Updates as { createdAt?: Date | string | null }).createdAt ??
    (Updates.manifest as { createdAt?: string } | null)?.createdAt;
  if (!raw) return "—";
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(raw);
}

function channelName(): string {
  return Updates.channel ? String(Updates.channel) : "—";
}

function downloadedIdFromContext(ctx: typeof latestContext): string | null {
  const id = (ctx?.downloadedManifest as { id?: string } | null | undefined)?.id;
  return strId(id);
}

function availableIdFromContext(ctx: typeof latestContext): string | null {
  const id = (ctx?.latestManifest as { id?: string } | null | undefined)?.id;
  return strId(id);
}

export function readOtaBannerTraceSync(opts?: {
  availableUpdateIdFromCheck?: string | null;
  checkResult?: string | null;
  persistedReadyId?: string | null;
}): OtaBannerTraceSnapshot {
  const ctx = latestContext;
  const runningUpdateId = strId(Updates.updateId);
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

  const recovery = readOtaRecoverySnapshot();
  const sessionNotes: string[] = [];
  if (recovery.pending) {
    sessionNotes.push(
      `otaRecoveryState.pending=true reloadTarget=${recovery.reloadTargetId}`,
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
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    createdAt: formatCreatedAt(),
    runtimeVersion: String(Updates.runtimeVersion ?? "—"),
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
    recoveryReloadTargetId: recovery.reloadTargetId,
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
      ...snap.sessionNotes.map((n) => `note: ${n}`),
    ].join("\n"),
  );
  pushOtaLog(
    "checkForUpdateAsync",
    true,
    `bannerTrace v${snap.otaIdentityFixVersion} visible=${snap.bannerVisible} running=${snap.runningUpdateId ?? "null"} downloaded=${snap.downloadedUpdateId ?? "null"} nativePending=${snap.nativeIsUpdatePending}`,
  );
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

export function formatOtaBannerTraceLines(snap: OtaBannerTraceSnapshot): string[] {
  return [
    `OTA_IDENTITY_FIX_VERSION: ${snap.otaIdentityFixVersion}`,
    `at: ${snap.at}`,
    `Updates.updateId (running): ${snap.runningUpdateId ?? "—"}`,
    `Updates.isEmbeddedLaunch: ${snap.isEmbeddedLaunch}`,
    `Updates.createdAt: ${snap.createdAt}`,
    `runtimeVersion: ${snap.runtimeVersion}`,
    `channel: ${snap.channel}`,
    `downloadedManifest.id: ${snap.downloadedUpdateId ?? "—"}`,
    `latestManifest.id: ${snap.availableUpdateIdFromContext ?? "—"}`,
    `check availableUpdateId: ${snap.availableUpdateIdFromCheck ?? "—"}`,
    `checkResult: ${snap.checkResult ?? "—"}`,
    `persisted @stadium/ota-update-ready: ${snap.persistedReadyId ?? "—"}`,
    `latestContext.isUpdatePending: ${snap.nativeIsUpdatePending}`,
    `latestContext.isDownloading: ${snap.nativeIsDownloading}`,
    `genuinelyPending: ${snap.genuinelyPending}`,
    `bannerVisible: ${snap.bannerVisible}`,
    `bannerExpression: ${snap.bannerExpression}`,
    `recovery.pending: ${snap.recoveryPending}`,
    `recovery.reloadTargetId: ${snap.recoveryReloadTargetId}`,
    ...snap.sessionNotes.map((n) => `note: ${n}`),
  ];
}
