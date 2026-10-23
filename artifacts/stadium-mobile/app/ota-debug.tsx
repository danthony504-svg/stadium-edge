import { readCoachPropAuditReport } from "@/lib/coachPropAuditStore";
import { downloadCoachPropAudit } from "@/lib/coachPropAuditExport";
import { shouldShowOtaHomeDiagnostics } from "@/lib/navMenuAuth";
import * as Clipboard from "expo-clipboard";
import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { useColors } from "@/hooks/useColors";
import {
  canRunLiveOtaProbe,
  collectOtaLiveProbeDiagnostics,
  collectOtaStaticDiagnostics,
  forceOtaCheckFetchAndReload,
  LIVE_PROBE_STARTUP_WAIT_MESSAGE,
  OTA_DEBUG_IDLE_CHECK_RESULT,
  readOtaDebugSnapshot,
  type OtaFullDiagnostics,
} from "@/lib/otaDebug";
import {
  EXPECTED_HEALTHY_EMBEDDED,
  EXPECTED_HEALTHY_RUNTIME,
  classifyDeviceAttestation,
  formatChannelTipMatchLabel,
  formatOtaChannelStreamLabel,
  resolveKnownChannelTipUpdateId,
} from "@/lib/otaDeviceAttestation";
import {
  buildSafeRequiredFields,
  OTA_DEBUG_UNAVAILABLE,
  safeDiagText,
  safeLogLines,
} from "@/lib/otaDebugGuards";
import { peekOtaController } from "@/lib/ota/otaControllerSingleton";
import type { OtaSnapshot } from "@/lib/ota/types";
import { formatOtaLogLines } from "@/lib/otaLaunchLog";
import { OTA_IDENTITY_FIX_VERSION } from "@/lib/otaUpdateIdentity";

/** Passive read of production controller — never boots/checks/restarts. */
function readControllerSnapshotPassive(): OtaSnapshot | null {
  try {
    return peekOtaController()?.getSnapshot() ?? null;
  } catch {
    return null;
  }
}

function emptyAttestation() {
  return classifyDeviceAttestation({
    runtimeVersion: OTA_DEBUG_UNAVAILABLE,
    updateId: OTA_DEBUG_UNAVAILABLE,
    isEmbeddedLaunch: true,
    appVersion: OTA_DEBUG_UNAVAILABLE,
    channel: OTA_DEBUG_UNAVAILABLE,
  });
}

function healthyBlock(opts: {
  channel: string;
  updateId: string;
  isEmbeddedLaunch: boolean;
  availableUpdateIdFromContext?: string;
  updateAvailable?: boolean | null;
  attestation: ReturnType<typeof classifyDeviceAttestation>;
}) {
  const tip =
    resolveKnownChannelTipUpdateId({
      availableUpdateIdFromContext: opts.availableUpdateIdFromContext,
      runningUpdateId: opts.updateId,
      updateAvailable: opts.updateAvailable,
      isEmbeddedLaunch: opts.isEmbeddedLaunch,
    }) ?? "";
  return {
    runtimeVersion: EXPECTED_HEALTHY_RUNTIME,
    isEmbeddedLaunch: EXPECTED_HEALTHY_EMBEDDED,
    channelTipUpdateId: tip,
    channelStreamLabel: formatOtaChannelStreamLabel(opts.channel),
    tipMatchLabel: formatChannelTipMatchLabel(opts.attestation.matchesChannelTip),
  };
}

/** Never throw during useState init / deep-link cold launch. */
function initialDiagnostics(): OtaFullDiagnostics {
  try {
    const snapshot = readOtaDebugSnapshot();
    const tip = resolveKnownChannelTipUpdateId({
      availableUpdateIdFromContext: snapshot.availableUpdateIdFromContext,
      runningUpdateId: snapshot.updateId,
      isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
    });
    const attestation = classifyDeviceAttestation({
      runtimeVersion: snapshot.runtimeVersion,
      updateId: snapshot.updateId,
      isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
      appVersion: snapshot.appVersion,
      channel: snapshot.channel,
      channelTipUpdateId: tip,
    });
    return {
      ...snapshot,
      checkResult: OTA_DEBUG_IDLE_CHECK_RESULT,
      fetchResult: "not run (live probe is check-only)",
      reloadResult: "not run",
      updateAvailable: null,
      fetchSucceeded: null,
      reloadSucceeded: null,
      startupLogs: ["loading native logs…"],
      jsLaunchLogs: safeLogLines(formatOtaLogLines(), "(none yet)"),
      attestation,
      expectedHealthy: healthyBlock({
        channel: snapshot.channel,
        updateId: snapshot.updateId,
        isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
        availableUpdateIdFromContext: snapshot.availableUpdateIdFromContext,
        attestation,
      }),
      caseCNativeSafety: "",
      bannerTrace: null,
      bannerTraceLines: ["loading banner identity trace…"],
      otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
      failedLaunchLedgerLines: ["loading failed-launch ledger…"],
      applyDiagnosis: "loading…",
      liveProbeRan: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attestation = emptyAttestation();
    return {
      appVersion: OTA_DEBUG_UNAVAILABLE,
      buildNumber: OTA_DEBUG_UNAVAILABLE,
      cfBundleShortVersion: OTA_DEBUG_UNAVAILABLE,
      runtimeVersion: OTA_DEBUG_UNAVAILABLE,
      channel: OTA_DEBUG_UNAVAILABLE,
      updateId: OTA_DEBUG_UNAVAILABLE,
      commitHash: "not-baked",
      updateCreatedAt: OTA_DEBUG_UNAVAILABLE,
      bundleSource: "unknown",
      updatesEnabled: false,
      isEmbeddedLaunch: true,
      isEmergencyLaunch: false,
      emergencyLaunchReason: OTA_DEBUG_UNAVAILABLE,
      checkAutomatically: OTA_DEBUG_UNAVAILABLE,
      fallbackToCacheTimeout: 0,
      launchDurationMs: OTA_DEBUG_UNAVAILABLE,
      isUpdatePending: false,
      isDownloading: false,
      isStartupProcedureRunning: false,
      rollbackCommitTime: OTA_DEBUG_UNAVAILABLE,
      checkError: `initialDiagnostics ERR: ${msg}`,
      downloadError: OTA_DEBUG_UNAVAILABLE,
      updateUrl: OTA_DEBUG_UNAVAILABLE,
      requestHeaders: OTA_DEBUG_UNAVAILABLE,
      projectId: OTA_DEBUG_UNAVAILABLE,
      deployMessage: OTA_DEBUG_UNAVAILABLE,
      expectedCommit: OTA_DEBUG_UNAVAILABLE,
      hasRnPurchasesNative: false,
      coachPipelineVersion: OTA_DEBUG_UNAVAILABLE,
      downloadedUpdateIdFromContext: OTA_DEBUG_UNAVAILABLE,
      availableUpdateIdFromContext: OTA_DEBUG_UNAVAILABLE,
      checkResult: OTA_DEBUG_IDLE_CHECK_RESULT,
      fetchResult: "not run (live probe is check-only)",
      reloadResult: "not run",
      updateAvailable: null,
      fetchSucceeded: null,
      reloadSucceeded: null,
      startupLogs: [`initialDiagnostics ERR: ${msg}`],
      jsLaunchLogs: ["(none yet)"],
      attestation,
      expectedHealthy: healthyBlock({
        channel: OTA_DEBUG_UNAVAILABLE,
        updateId: OTA_DEBUG_UNAVAILABLE,
        isEmbeddedLaunch: true,
        attestation,
      }),
      caseCNativeSafety: "",
      bannerTrace: null,
      bannerTraceLines: [`bannerTrace unavailable: ${msg}`],
      otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
      failedLaunchLedgerLines: [`ledger unavailable: ${msg}`],
      applyDiagnosis: `initialDiagnostics ERR: ${msg}`,
      liveProbeRan: false,
    };
  }
}

function OtaDiagnosticsErrorFallback({ error }: ErrorFallbackProps) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 24,
        backgroundColor: "#0b1220",
        gap: 10,
      }}
    >
      <Text style={{ color: "#f8fafc", fontSize: 20, fontWeight: "700" }}>
        OTA Diagnostics unavailable
      </Text>
      <Text style={{ color: "#94a3b8", fontSize: 14, lineHeight: 20 }}>
        This diagnostics-only screen encountered an error. The rest of Stadium Edge remains
        available — OTA update behavior was not changed.
      </Text>
      <Text numberOfLines={4} style={{ color: "#64748b", fontSize: 12, lineHeight: 18 }}>
        {safeDiagText(error?.message, "Unknown diagnostics error")}
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        {label}
      </Text>
      <Text
        selectable
        style={{ color: colors.foreground, fontFamily: FONT.body, fontSize: 13, lineHeight: 19 }}
      >
        {safeDiagText(value)}
      </Text>
    </View>
  );
}

function LogBlock({ title, lines }: { title: string; lines: unknown }) {
  const colors = useColors();
  const safe = safeLogLines(lines, "(none)");
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
        {title}
      </Text>
      {safe.map((line, i) => (
        <Text
          key={`${i}-${line.slice(0, 24)}`}
          selectable
          style={{
            color: colors.foreground,
            fontFamily: FONT.body,
            fontSize: 11,
            lineHeight: 16,
          }}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

function buildReport(diag: OtaFullDiagnostics): string {
  const required = buildSafeRequiredFields({
    updateId: diag.updateId,
    isEmbeddedLaunch: diag.isEmbeddedLaunch,
    createdAt: diag.updateCreatedAt,
    runtimeVersion: diag.runtimeVersion,
    channel: diag.channel,
    checkAvailableUpdateId: diag.bannerTrace?.availableUpdateIdFromCheck,
    downloadedUpdateId: diag.bannerTrace?.downloadedUpdateId,
    persistedReadyId: diag.bannerTrace?.persistedReadyId,
    isUpdatePending: diag.bannerTrace?.nativeIsUpdatePending ?? diag.isUpdatePending,
    recoveryPending: diag.bannerTrace?.recoveryPending,
    bannerExpression: diag.bannerTrace?.bannerExpression,
    otaIdentityFixVersion: diag.otaIdentityFixVersion ?? OTA_IDENTITY_FIX_VERSION,
    contextHydrated: true,
  });
  const attestation = diag.attestation ?? emptyAttestation();
  const stream =
    diag.expectedHealthy?.channelStreamLabel ||
    formatOtaChannelStreamLabel(diag.channel);
  const tipMatch =
    diag.expectedHealthy?.tipMatchLabel ||
    formatChannelTipMatchLabel(attestation.matchesChannelTip);
  const tipId = diag.expectedHealthy?.channelTipUpdateId?.trim() || "(not probed)";
  return [
    "=== Stadium Edge device attestation ===",
    `CHANNEL STREAM: ${stream}`,
    `CASE: ${safeDiagText(attestation.caseId)} — ${safeDiagText(attestation.label)}`,
    `summary: ${safeDiagText(attestation.summary)}`,
    `recovery: ${safeDiagText(attestation.recoveryPath)}`,
    "",
    `Updates.runtimeVersion: ${required.runtimeVersion}`,
    `Updates.updateId (running): ${required.updateId}`,
    `Updates.isEmbeddedLaunch: ${required.isEmbeddedLaunch}`,
    `app version / CFBundleShortVersionString: ${safeDiagText(diag.cfBundleShortVersion)}`,
    `native build number: ${safeDiagText(diag.buildNumber)}`,
    `update channel: ${required.channel}`,
    `hasRnPurchasesNative: ${safeDiagText(diag.hasRnPurchasesNative)}`,
    "",
    `healthy criteria: runtimeVersion=${EXPECTED_HEALTHY_RUNTIME}, isEmbeddedLaunch=${String(EXPECTED_HEALTHY_EMBEDDED)}, non-blank updateId, equals current ${stream} channel tip when tip is known`,
    `known channel tip updateId: ${tipId}`,
    `equals channel tip: ${tipMatch}`,
    "",
    `update check finds available update: ${safeDiagText(diag.updateAvailable)}`,
    `fetch succeeds: ${safeDiagText(diag.fetchSucceeded)}`,
    `reload/apply succeeds: ${safeDiagText(diag.reloadSucceeded)}`,
    `checkForUpdateAsync: ${safeDiagText(diag.checkResult)}`,
    `fetchUpdateAsync: ${safeDiagText(diag.fetchResult)}`,
    `reloadAsync: ${safeDiagText(diag.reloadResult)}`,
    "",
    `Updates.isEnabled: ${safeDiagText(diag.updatesEnabled)}`,
    `Updates.isEmergencyLaunch: ${safeDiagText(diag.isEmergencyLaunch)}`,
    `Updates.emergencyLaunchReason: ${safeDiagText(diag.emergencyLaunchReason)}`,
    `Updates.createdAt: ${required.createdAt}`,
    `bundle source: ${safeDiagText(diag.bundleSource)}`,
    `commit (running): ${safeDiagText(diag.commitHash)}`,
    `deploy message: ${safeDiagText(diag.deployMessage)}`,
    `native checkError: ${safeDiagText(diag.checkError)}`,
    `native downloadError: ${safeDiagText(diag.downloadError)}`,
    `OTA_IDENTITY_FIX_VERSION: ${required.otaIdentityFixVersion}`,
    `latestContext.isUpdatePending: ${required.isUpdatePending}`,
    `recovery.pending: ${required.recoveryPending}`,
    `bannerExpression: ${required.bannerExpression}`,
    `check available update ID: ${required.checkAvailableUpdateId}`,
    `downloaded update ID: ${required.downloadedUpdateId}`,
    `persisted ready ID: ${required.persistedReadyId}`,
    `downloadedManifest.id (context): ${safeDiagText(diag.downloadedUpdateIdFromContext)}`,
    `latestManifest.id (context): ${safeDiagText(diag.availableUpdateIdFromContext)}`,
    `isStartupProcedureRunning: ${safeDiagText(diag.isStartupProcedureRunning)}`,
    `fallbackToCacheTimeout: ${safeDiagText(diag.fallbackToCacheTimeout)}`,
    `updateUrl: ${safeDiagText(diag.updateUrl)}`,
    `projectId: ${safeDiagText(diag.projectId)}`,
    `liveProbeRan: ${safeDiagText(diag.liveProbeRan)}`,
    "",
    "--- apply / rollback diagnosis ---",
    safeDiagText(diag.applyDiagnosis),
    "",
    "--- JS failed-launch ledger ---",
    ...safeLogLines(diag.failedLaunchLedgerLines, "(none)"),
    "",
    "--- banner identity trace (why App update ready shows) ---",
    ...safeLogLines(diag.bannerTraceLines, "bannerTrace unavailable"),
    "",
    ...(attestation.caseId === "C" && diag.caseCNativeSafety
      ? [safeDiagText(diag.caseCNativeSafety), ""]
      : []),
    "--- expo-updates native logs (last hour) ---",
    ...safeLogLines(diag.startupLogs, "(none)"),
    "",
    "--- JS launch OTA logs ---",
    ...safeLogLines(diag.jsLaunchLogs, "(none)"),
  ].join("\n");
}

export default function OtaDebugScreen() {
  return (
    <ErrorBoundary FallbackComponent={OtaDiagnosticsErrorFallback}>
      <OtaDebugScreenInner />
    </ErrorBoundary>
  );
}

function OtaDebugScreenInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Lazy init is guarded; still prefer effect refresh so deep-link cold launch
  // can paint a shell before any async Updates / AsyncStorage work.
  const [diag, setDiag] = useState<OtaFullDiagnostics>(initialDiagnostics);
  const [controllerSnap, setControllerSnap] = useState<OtaSnapshot | null>(
    readControllerSnapshotPassive,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auditExportBusy, setAuditExportBusy] = useState(false);
  const [staticLoading, setStaticLoading] = useState(true);
  const [liveProbeLoading, setLiveProbeLoading] = useState(false);

  /** Static-only refresh — never calls checkForUpdateAsync. */
  const refreshStatic = useCallback(async () => {
    setStaticLoading(true);
    try {
      const next = await collectOtaStaticDiagnostics();
      setDiag(next);
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDiag((prev) => ({
        ...(prev ?? initialDiagnostics()),
        startupLogs: [`collectOtaStaticDiagnostics ERR: ${msg}`],
        bannerTrace: null,
        bannerTraceLines: [`bannerTrace ERR: ${msg}`],
        applyDiagnosis: `static diagnostics ERR: ${msg}`,
        failedLaunchLedgerLines: [`ledger ERR: ${msg}`],
        otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
        liveProbeRan: false,
        checkResult: OTA_DEBUG_IDLE_CHECK_RESULT,
        fetchResult: "not run (live probe is check-only)",
        reloadResult: "not run",
      }));
      return null;
    } finally {
      setStaticLoading(false);
    }
  }, []);

  const startupBlockingLive = !canRunLiveOtaProbe(!!diag.isStartupProcedureRunning);

  const runLiveProbe = useCallback(async () => {
    if (!canRunLiveOtaProbe(!!diag.isStartupProcedureRunning)) {
      setStatus(LIVE_PROBE_STARTUP_WAIT_MESSAGE);
      return null;
    }
    setLiveProbeLoading(true);
    setStatus("Running live OTA probe (checkForUpdateAsync only)…");
    try {
      const next = await collectOtaLiveProbeDiagnostics();
      setDiag(next);
      setStatus(
        next.updateAvailable == null
          ? "Live probe finished — see check result"
          : next.updateAvailable
            ? "Live probe: update available"
            : "Live probe: no update available",
      );
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDiag((prev) => ({
        ...(prev ?? initialDiagnostics()),
        checkResult: `ERR: ${msg}`,
        fetchResult: "skipped (live probe failed)",
        reloadResult: "skipped",
        updateAvailable: null,
        liveProbeRan: true,
      }));
      setStatus(`Live probe ERR: ${msg}`);
      return null;
    } finally {
      setLiveProbeLoading(false);
    }
  }, [diag.isStartupProcedureRunning]);

  useEffect(() => {
    // Static state only on open — no automatic checkForUpdateAsync.
    // Passive controller snapshot refresh (read-only; does not init OTA).
    setControllerSnap(readControllerSnapshotPassive());
    void refreshStatic();
  }, [refreshStatic]);

  const copyAll = async () => {
    try {
      const snap = diag ?? (await refreshStatic());
      if (!snap) return;
      await Clipboard.setStringAsync(buildReport(snap));
      setStatus("Copied full attestation report to clipboard");
    } catch (e) {
      setStatus(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runCheckFetchReload = async () => {
    if (!canRunLiveOtaProbe(!!diag.isStartupProcedureRunning)) {
      setStatus(LIVE_PROBE_STARTUP_WAIT_MESSAGE);
      return;
    }
    setBusy(true);
    setStatus("checkForUpdateAsync → fetchUpdateAsync → reloadAsync…");
    try {
      const result = await forceOtaCheckFetchAndReload();
      if (result.reloaded) {
        setStatus(result.reloadResult ?? "Reloading into new bundle…");
        return;
      }
      const next = await refreshStatic();
      if (next) {
        setDiag({
          ...next,
          checkResult: result.checkResult ?? next.checkResult,
          fetchResult: result.fetchResult ?? next.fetchResult,
          reloadResult: result.reloadResult ?? next.reloadResult,
          updateAvailable: result.updateAvailable ?? next.updateAvailable,
          fetchSucceeded: result.fetchSucceeded ?? next.fetchSucceeded,
          reloadSucceeded: result.reloadSucceeded ?? next.reloadSucceeded,
          liveProbeRan: true,
        });
      }
      setStatus(
        [result.reason, result.reloadResult].filter(Boolean).join(" · ") ||
          "Probe finished — see check/fetch/reload rows",
      );
    } catch (e) {
      setStatus(`Probe ERR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const attestation = diag.attestation ?? emptyAttestation();
  const required = buildSafeRequiredFields({
    updateId: diag.updateId,
    isEmbeddedLaunch: diag.isEmbeddedLaunch,
    createdAt: diag.updateCreatedAt,
    runtimeVersion: diag.runtimeVersion,
    channel: diag.channel,
    checkAvailableUpdateId: diag.bannerTrace?.availableUpdateIdFromCheck,
    downloadedUpdateId: diag.bannerTrace?.downloadedUpdateId,
    persistedReadyId: diag.bannerTrace?.persistedReadyId,
    isUpdatePending: diag.bannerTrace?.nativeIsUpdatePending ?? diag.isUpdatePending,
    recoveryPending: diag.bannerTrace?.recoveryPending,
    bannerExpression: diag.bannerTrace?.bannerExpression,
    otaIdentityFixVersion: diag.otaIdentityFixVersion ?? OTA_IDENTITY_FIX_VERSION,
    contextHydrated: diag.bannerTrace != null || !staticLoading,
  });

  const embeddedWarning =
    diag.isEmbeddedLaunch && diag.updatesEnabled
      ? "Running embedded bundle. If check/fetch succeed but isEmbeddedLaunch stays true after force-reload, error recovery may be rolling back every launch."
      : null;

  const caseColor =
    attestation.caseId === "A"
      ? "#86efac"
      : attestation.caseId === "B"
        ? "#fde68a"
        : attestation.caseId === "C"
          ? "#fca5a5"
          : "#cbd5e1";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20, flex: 1 }}>
          Device attestation
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
      >
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, lineHeight: 19 }}>
          Temporary read-only probe for stale Coach UI.{" "}
          <Text style={{ fontFamily: FONT.semibold }}>
            CHANNEL STREAM:{" "}
            {safeDiagText(
              diag.expectedHealthy?.channelStreamLabel ||
                formatOtaChannelStreamLabel(diag.channel),
            )}
          </Text>
          . Healthy when runtime{" "}
          <Text style={{ fontFamily: FONT.semibold }}>{EXPECTED_HEALTHY_RUNTIME}</Text>,{" "}
          isEmbeddedLaunch=
          <Text style={{ fontFamily: FONT.semibold }}>{String(EXPECTED_HEALTHY_EMBEDDED)}</Text>,
          non-blank running updateId, and (when tip is known) running update equals the current
          channel tip — not a hardcoded historical id.
          {staticLoading ? (
            <Text style={{ fontFamily: FONT.medium }}> Loading static state…</Text>
          ) : (
            <Text style={{ fontFamily: FONT.medium }}>
              {" "}
              Static only — live checkForUpdateAsync is manual.
            </Text>
          )}
        </Text>

        <View
          style={{
            backgroundColor: "rgba(15,23,42,0.92)",
            borderWidth: 1,
            borderColor: caseColor,
            borderRadius: 12,
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: caseColor, fontFamily: FONT.semibold, fontSize: 14 }}>
            {safeDiagText(
              diag.expectedHealthy?.channelStreamLabel ||
                formatOtaChannelStreamLabel(diag.channel),
            )}{" "}
            · {safeDiagText(attestation.caseId)} — {safeDiagText(attestation.label)}
          </Text>
          <Text
            selectable
            style={{ color: "#e2e8f0", fontFamily: FONT.body, fontSize: 12, lineHeight: 18 }}
          >
            {safeDiagText(attestation.summary)}
          </Text>
          <Text
            selectable
            style={{ color: "#94a3b8", fontFamily: FONT.body, fontSize: 12, lineHeight: 18 }}
          >
            Recovery: {safeDiagText(attestation.recoveryPath)}
          </Text>
        </View>

        {embeddedWarning ? (
          <View
            style={{
              backgroundColor: "rgba(234,179,8,0.12)",
              borderWidth: 1,
              borderColor: "rgba(234,179,8,0.35)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <Text style={{ color: "#fde68a", fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
              {embeddedWarning}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            OtaController (passive)
          </Text>
          <Row
            label="state"
            value={safeDiagText(controllerSnap?.state, "not mounted yet")}
          />
          <Row
            label="bannerVisible"
            value={safeDiagText(controllerSnap?.bannerVisible, "—")}
          />
          <Row
            label="runningUpdateId"
            value={safeDiagText(controllerSnap?.runningUpdateId)}
          />
          <Row
            label="discoveredUpdateId"
            value={safeDiagText(controllerSnap?.discoveredUpdateId)}
          />
          <Row
            label="downloadedUpdateId"
            value={safeDiagText(controllerSnap?.downloadedUpdateId)}
          />
          <Row label="lastError" value={safeDiagText(controllerSnap?.lastError)} />
          <Row
            label="failedUpdateId"
            value={safeDiagText(controllerSnap?.failedUpdateId)}
          />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Apply / rollback diagnosis (static)
          </Text>
          <Text
            selectable
            style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 18 }}
          >
            {safeDiagText(diag.applyDiagnosis, "—")}
          </Text>
          <Row label="Bundle source" value={safeDiagText(diag.bundleSource)} />
          <Row
            label="isStartupProcedureRunning"
            value={safeDiagText(diag.isStartupProcedureRunning)}
          />
          <Row
            label="fallbackToCacheTimeout"
            value={safeDiagText(diag.fallbackToCacheTimeout)}
          />
          <Row label="update URL" value={safeDiagText(diag.updateUrl)} />
          <Row label="EAS projectId" value={safeDiagText(diag.projectId)} />
          <Row
            label="downloadedManifest.id (context)"
            value={safeDiagText(
              diag.bannerTrace?.downloadedUpdateId ?? diag.downloadedUpdateIdFromContext,
            )}
          />
          <Row
            label="latestManifest.id (context)"
            value={safeDiagText(
              diag.bannerTrace?.availableUpdateIdFromContext ??
                diag.availableUpdateIdFromContext,
            )}
          />
          <Row label="native rollback commitTime" value={safeDiagText(diag.rollbackCommitTime)} />
          <LogBlock title="JS failed-launch ledger" lines={diag.failedLaunchLedgerLines} />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Required OTA identity fields (crash-safe)
          </Text>
          <Row label="Updates.updateId" value={required.updateId} />
          <Row label="Updates.isEmbeddedLaunch" value={required.isEmbeddedLaunch} />
          <Row label="Updates.createdAt" value={required.createdAt} />
          <Row label="runtimeVersion" value={required.runtimeVersion} />
          <Row label="channel" value={required.channel} />
          <Row label="check/available update ID" value={required.checkAvailableUpdateId} />
          <Row label="downloaded update ID" value={required.downloadedUpdateId} />
          <Row label="persisted ready ID" value={required.persistedReadyId} />
          <Row label="latestContext.isUpdatePending" value={required.isUpdatePending} />
          <Row label="recovery pending" value={required.recoveryPending} />
          <Row label="banner expression" value={required.bannerExpression} />
          <Row label="OTA_IDENTITY_FIX_VERSION" value={required.otaIdentityFixVersion} />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Device attestation values
          </Text>
          <Row label="Updates.runtimeVersion" value={safeDiagText(diag.runtimeVersion)} />
          <Row label="Updates.updateId" value={safeDiagText(diag.updateId)} />
          <Row label="Updates.isEmbeddedLaunch" value={safeDiagText(diag.isEmbeddedLaunch)} />
          <Row
            label="app version / CFBundleShortVersionString"
            value={safeDiagText(diag.cfBundleShortVersion)}
          />
          <Row label="native build number" value={safeDiagText(diag.buildNumber)} />
          <Row label="update channel" value={safeDiagText(diag.channel)} />
          <Row
            label="hasRnPurchasesNative (Case C signal)"
            value={safeDiagText(diag.hasRnPurchasesNative)}
          />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Healthy criteria (no hardcoded tip id)
          </Text>
          <Row
            label="CHANNEL STREAM"
            value={safeDiagText(
              diag.expectedHealthy?.channelStreamLabel ||
                formatOtaChannelStreamLabel(diag.channel),
            )}
          />
          <Row
            label="target runtimeVersion"
            value={safeDiagText(diag.expectedHealthy?.runtimeVersion)}
          />
          <Row
            label="target isEmbeddedLaunch"
            value={safeDiagText(diag.expectedHealthy?.isEmbeddedLaunch)}
          />
          <Row
            label="running updateId"
            value={safeDiagText(diag.updateId)}
          />
          <Row
            label="known channel tip updateId"
            value={
              diag.expectedHealthy?.channelTipUpdateId?.trim()
                ? safeDiagText(diag.expectedHealthy.channelTipUpdateId)
                : "(not probed)"
            }
          />
          <Row
            label="equals channel tip?"
            value={safeDiagText(
              diag.expectedHealthy?.tipMatchLabel ||
                formatChannelTipMatchLabel(attestation.matchesChannelTip),
            )}
          />
          <Row
            label="recovery pending"
            value={safeDiagText(diag.bannerTrace?.recoveryPending, "—")}
          />
          <Row
            label="emergency launch"
            value={`${safeDiagText(diag.isEmergencyLaunch)} · ${safeDiagText(diag.emergencyLaunchReason)}`}
          />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Update check / fetch / reload
          </Text>
          <Row
            label="update check finds available update"
            value={safeDiagText(diag.updateAvailable)}
          />
          <Row label="fetch succeeds" value={safeDiagText(diag.fetchSucceeded)} />
          <Row label="reload/apply succeeds" value={safeDiagText(diag.reloadSucceeded)} />
          <Row label="checkForUpdateAsync()" value={safeDiagText(diag.checkResult)} />
          <Row label="fetchUpdateAsync()" value={safeDiagText(diag.fetchResult)} />
          <Row label="reloadAsync()" value={safeDiagText(diag.reloadResult)} />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Banner identity trace (read-only)
          </Text>
          <Row
            label="OTA_IDENTITY_FIX_VERSION (missing ⇒ pre-fix OTA)"
            value={required.otaIdentityFixVersion}
          />
          <Row label="running Updates.updateId" value={required.updateId} />
          <Row label="downloadedManifest.id" value={required.downloadedUpdateId} />
          <Row label="check availableUpdateId" value={required.checkAvailableUpdateId} />
          <Row label="persisted @stadium/ota-update-ready" value={required.persistedReadyId} />
          <Row label="latestContext.isUpdatePending" value={required.isUpdatePending} />
          <Row
            label="genuinelyPending (identity gate)"
            value={safeDiagText(diag.bannerTrace?.genuinelyPending, "—")}
          />
          <Row
            label="bannerVisible"
            value={safeDiagText(diag.bannerTrace?.bannerVisible, "—")}
          />
          <Row label="bannerExpression" value={required.bannerExpression} />
          <Row
            label="recovery.pending / reloadTarget"
            value={`${required.recoveryPending} / ${safeDiagText(diag.bannerTrace?.recoveryReloadTargetId, "—")}`}
          />
          <LogBlock title="banner trace lines" lines={diag.bannerTraceLines} />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 14,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Running bundle (Updates.*)
          </Text>
          <Row label="Updates.isEnabled" value={safeDiagText(diag.updatesEnabled)} />
          <Row label="Updates.isEmergencyLaunch" value={safeDiagText(diag.isEmergencyLaunch)} />
          <Row
            label="Updates.emergencyLaunchReason"
            value={safeDiagText(diag.emergencyLaunchReason)}
          />
          <Row label="Updates.createdAt" value={required.createdAt} />
          <Row label="Bundle source" value={safeDiagText(diag.bundleSource)} />
          <Row label="Commit hash (running JS)" value={safeDiagText(diag.commitHash)} />
          <Row label="Deploy message" value={safeDiagText(diag.deployMessage)} />
          <Row label="native checkError" value={safeDiagText(diag.checkError)} />
          <Row label="native downloadError" value={safeDiagText(diag.downloadError)} />
        </View>

        {attestation.caseId === "C" && diag.caseCNativeSafety ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              gap: 8,
            }}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
              Case C — native-module compatibility
            </Text>
            <Text
              selectable
              style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}
            >
              {safeDiagText(diag.caseCNativeSafety)}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 12,
          }}
        >
          <LogBlock title="expo-updates native logs (startup / error recovery)" lines={diag.startupLogs} />
          <LogBlock
            title="JS OtaStartupGate / manual logs"
            lines={diag.jsLaunchLogs?.length ? diag.jsLaunchLogs : ["(none yet)"]}
          />
        </View>

        {status ? (
          <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 13 }}>
            {safeDiagText(status)}
          </Text>
        ) : null}

        <View style={{ gap: 10 }}>
          {startupBlockingLive ? (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.medium,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {LIVE_PROBE_STARTUP_WAIT_MESSAGE}
            </Text>
          ) : null}
          <Pressable
            onPress={() => void runLiveProbe()}
            disabled={liveProbeLoading || busy || startupBlockingLive}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 10,
              paddingVertical: 14,
              alignItems: "center",
              opacity:
                pressed || liveProbeLoading || busy || startupBlockingLive ? 0.5 : 1,
            })}
          >
            {liveProbeLoading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold, fontSize: 15 }}>
                Run live OTA probe
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void runCheckFetchReload()}
            disabled={busy || liveProbeLoading || startupBlockingLive}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingVertical: 14,
              alignItems: "center",
              opacity: pressed || busy || liveProbeLoading || startupBlockingLive ? 0.5 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
                Check, fetch & reload (expo-updates)
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void refreshStatic().then(() => setStatus("Refreshed static state"))}
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 14 }}>
              Refresh static attestation & logs
            </Text>
          </Pressable>

          {shouldShowOtaHomeDiagnostics(diag.channel, __DEV__) && (
            <View>
              <Pressable
                disabled={auditExportBusy}
                accessibilityRole="button"
                onPress={() => {
                  if (auditExportBusy) return;
                  setAuditExportBusy(true);
                  void downloadCoachPropAudit().then(result => {
                    setStatus(result === "empty" ? "Build a Coach ticket first, then download its report."
                      : result === "saved" ? "Prop audit downloaded."
                      : result === "shared" ? "Prop audit shared or saved."
                      : "Download cancelled.");
                  }).catch(() => setStatus("Could not download the report. You can still copy it below."))
                    .finally(() => setAuditExportBusy(false));
                }}
                style={{ paddingVertical: 14, alignItems: "center", opacity: auditExportBusy ? 0.5 : 1 }}
              >
                <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 15 }}>
                  {auditExportBusy ? "Preparing report…" : "Download latest prop audit"}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, marginTop: 4 }}>
                  Save to Files or share the report as a file.
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { void readCoachPropAuditReport().then(report => Clipboard.setStringAsync(report)).then(() => setStatus("Copied latest prop audit")).catch(() => setStatus("Could not copy prop audit")); }}
                style={{ paddingVertical: 12, alignItems: "center" }}
              >
                <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 14 }}>Copy latest prop audit</Text>
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={() => void copyAll()}
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 14 }}>
              Copy full attestation report
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
