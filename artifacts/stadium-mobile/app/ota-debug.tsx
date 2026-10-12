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
  collectOtaFullDiagnostics,
  forceOtaCheckFetchAndReload,
  readOtaDebugSnapshot,
  type OtaFullDiagnostics,
} from "@/lib/otaDebug";
import {
  EXPECTED_HEALTHY_EMBEDDED,
  EXPECTED_HEALTHY_RUNTIME,
  EXPECTED_HEALTHY_UPDATE_ID,
  classifyDeviceAttestation,
} from "@/lib/otaDeviceAttestation";
import {
  buildSafeRequiredFields,
  OTA_DEBUG_UNAVAILABLE,
  safeDiagText,
  safeLogLines,
} from "@/lib/otaDebugGuards";
import { formatOtaLogLines } from "@/lib/otaLaunchLog";
import { OTA_IDENTITY_FIX_VERSION } from "@/lib/otaUpdateIdentity";

function emptyAttestation() {
  return classifyDeviceAttestation({
    runtimeVersion: OTA_DEBUG_UNAVAILABLE,
    updateId: OTA_DEBUG_UNAVAILABLE,
    isEmbeddedLaunch: true,
    appVersion: OTA_DEBUG_UNAVAILABLE,
  });
}

/** Never throw during useState init / deep-link cold launch. */
function initialDiagnostics(): OtaFullDiagnostics {
  try {
    const snapshot = readOtaDebugSnapshot();
    const attestation = classifyDeviceAttestation({
      runtimeVersion: snapshot.runtimeVersion,
      updateId: snapshot.updateId,
      isEmbeddedLaunch: snapshot.isEmbeddedLaunch,
      appVersion: snapshot.appVersion,
    });
    return {
      ...snapshot,
      checkResult: "loading…",
      fetchResult: "—",
      reloadResult: "—",
      updateAvailable: null,
      fetchSucceeded: null,
      reloadSucceeded: null,
      startupLogs: ["loading native logs…"],
      jsLaunchLogs: safeLogLines(formatOtaLogLines(), "(none yet)"),
      attestation,
      expectedHealthy: {
        runtimeVersion: EXPECTED_HEALTHY_RUNTIME,
        updateId: EXPECTED_HEALTHY_UPDATE_ID,
        isEmbeddedLaunch: EXPECTED_HEALTHY_EMBEDDED,
      },
      caseCNativeSafety: "",
      bannerTrace: null,
      bannerTraceLines: ["loading banner identity trace…"],
      otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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
      checkResult: `ERR: ${msg}`,
      fetchResult: "—",
      reloadResult: "—",
      updateAvailable: null,
      fetchSucceeded: null,
      reloadSucceeded: null,
      startupLogs: [`initialDiagnostics ERR: ${msg}`],
      jsLaunchLogs: ["(none yet)"],
      attestation: emptyAttestation(),
      expectedHealthy: {
        runtimeVersion: EXPECTED_HEALTHY_RUNTIME,
        updateId: EXPECTED_HEALTHY_UPDATE_ID,
        isEmbeddedLaunch: EXPECTED_HEALTHY_EMBEDDED,
      },
      caseCNativeSafety: "",
      bannerTrace: null,
      bannerTraceLines: [`bannerTrace unavailable: ${msg}`],
      otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
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
  return [
    "=== Stadium Edge device attestation ===",
    `CASE: ${safeDiagText(attestation.caseId)} — ${safeDiagText(attestation.label)}`,
    `summary: ${safeDiagText(attestation.summary)}`,
    `recovery: ${safeDiagText(attestation.recoveryPath)}`,
    "",
    `Updates.runtimeVersion: ${required.runtimeVersion}`,
    `Updates.updateId: ${required.updateId}`,
    `Updates.isEmbeddedLaunch: ${required.isEmbeddedLaunch}`,
    `app version / CFBundleShortVersionString: ${safeDiagText(diag.cfBundleShortVersion)}`,
    `native build number: ${safeDiagText(diag.buildNumber)}`,
    `update channel: ${required.channel}`,
    `hasRnPurchasesNative: ${safeDiagText(diag.hasRnPurchasesNative)}`,
    "",
    `expected runtimeVersion: ${safeDiagText(diag.expectedHealthy?.runtimeVersion)}`,
    `expected updateId: ${safeDiagText(diag.expectedHealthy?.updateId)}`,
    `expected isEmbeddedLaunch: ${safeDiagText(diag.expectedHealthy?.isEmbeddedLaunch)}`,
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
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probeLoading, setProbeLoading] = useState(true);

  const refresh = useCallback(async () => {
    setProbeLoading(true);
    try {
      const next = await collectOtaFullDiagnostics();
      setDiag(next);
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDiag((prev) => ({
        ...(prev ?? initialDiagnostics()),
        checkResult: `ERR: ${msg}`,
        fetchResult: "skipped (refresh failed)",
        reloadResult: "skipped",
        updateAvailable: null,
        fetchSucceeded: null,
        reloadSucceeded: null,
        startupLogs: [`collectOtaFullDiagnostics ERR: ${msg}`],
        bannerTrace: null,
        bannerTraceLines: [`bannerTrace ERR: ${msg}`],
        otaIdentityFixVersion: OTA_IDENTITY_FIX_VERSION,
      }));
      return null;
    } finally {
      setProbeLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer probe past first paint so deep-link cold start can hydrate providers
    // without blocking the diagnostics shell. Read-only — does not mutate OTA apply state.
    void refresh();
  }, [refresh]);

  const copyAll = async () => {
    try {
      const snap = diag ?? (await refresh());
      if (!snap) return;
      await Clipboard.setStringAsync(buildReport(snap));
      setStatus("Copied full attestation report to clipboard");
    } catch (e) {
      setStatus(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runCheckFetchReload = async () => {
    setBusy(true);
    setStatus("checkForUpdateAsync → fetchUpdateAsync → reloadAsync…");
    try {
      const result = await forceOtaCheckFetchAndReload();
      if (result.reloaded) {
        setStatus(result.reloadResult ?? "Reloading into new bundle…");
        return;
      }
      const next = await refresh();
      if (next) {
        setDiag({
          ...next,
          checkResult: result.checkResult ?? next.checkResult,
          fetchResult: result.fetchResult ?? next.fetchResult,
          reloadResult: result.reloadResult ?? next.reloadResult,
          updateAvailable: result.updateAvailable ?? next.updateAvailable,
          fetchSucceeded: result.fetchSucceeded ?? next.fetchSucceeded,
          reloadSucceeded: result.reloadSucceeded ?? next.reloadSucceeded,
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
    contextHydrated: diag.bannerTrace != null || !probeLoading,
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
          Temporary read-only probe for stale Coach UI. Healthy device: runtime{" "}
          <Text style={{ fontFamily: FONT.semibold }}>{EXPECTED_HEALTHY_RUNTIME}</Text>, updateId{" "}
          <Text style={{ fontFamily: FONT.semibold }}>{EXPECTED_HEALTHY_UPDATE_ID}</Text>,{" "}
          isEmbeddedLaunch=
          <Text style={{ fontFamily: FONT.semibold }}>{String(EXPECTED_HEALTHY_EMBEDDED)}</Text>.
          {probeLoading ? (
            <Text style={{ fontFamily: FONT.medium }}> Live probe still running…</Text>
          ) : null}
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
            {safeDiagText(attestation.caseId)} — {safeDiagText(attestation.label)}
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
            Expected healthy
          </Text>
          <Row
            label="runtimeVersion"
            value={safeDiagText(diag.expectedHealthy?.runtimeVersion)}
          />
          <Row label="updateId" value={safeDiagText(diag.expectedHealthy?.updateId)} />
          <Row
            label="isEmbeddedLaunch"
            value={safeDiagText(diag.expectedHealthy?.isEmbeddedLaunch)}
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
          <Pressable
            onPress={() => void runCheckFetchReload()}
            disabled={busy}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 10,
              paddingVertical: 14,
              alignItems: "center",
              opacity: pressed || busy ? 0.85 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold, fontSize: 15 }}>
                Check, fetch & reload (expo-updates)
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void refresh().then(() => setStatus("Refreshed"))}
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 14 }}>
              Refresh attestation & logs
            </Text>
          </Pressable>

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
