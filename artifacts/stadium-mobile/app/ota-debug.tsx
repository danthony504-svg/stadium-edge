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
import { formatOtaLogLines } from "@/lib/otaLaunchLog";
import { OTA_IDENTITY_FIX_VERSION } from "@/lib/otaUpdateIdentity";

function initialDiagnostics(): OtaFullDiagnostics {
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
    jsLaunchLogs: formatOtaLogLines(),
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
        {value}
      </Text>
    </View>
  );
}

function LogBlock({ title, lines }: { title: string; lines: string[] }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
        {title}
      </Text>
      {lines.map((line, i) => (
        <Text
          key={`${i}-${String(line ?? "").slice(0, 24)}`}
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
  return [
    "=== Stadium Edge device attestation ===",
    `CASE: ${diag.attestation.caseId} — ${diag.attestation.label}`,
    `summary: ${diag.attestation.summary}`,
    `recovery: ${diag.attestation.recoveryPath}`,
    "",
    `Updates.runtimeVersion: ${diag.runtimeVersion}`,
    `Updates.updateId: ${diag.updateId}`,
    `Updates.isEmbeddedLaunch: ${diag.isEmbeddedLaunch}`,
    `app version / CFBundleShortVersionString: ${diag.cfBundleShortVersion}`,
    `native build number: ${diag.buildNumber}`,
    `update channel: ${diag.channel}`,
    `hasRnPurchasesNative: ${diag.hasRnPurchasesNative}`,
    "",
    `expected runtimeVersion: ${diag.expectedHealthy.runtimeVersion}`,
    `expected updateId: ${diag.expectedHealthy.updateId}`,
    `expected isEmbeddedLaunch: ${diag.expectedHealthy.isEmbeddedLaunch}`,
    "",
    `update check finds available update: ${String(diag.updateAvailable)}`,
    `fetch succeeds: ${String(diag.fetchSucceeded)}`,
    `reload/apply succeeds: ${String(diag.reloadSucceeded)}`,
    `checkForUpdateAsync: ${diag.checkResult}`,
    `fetchUpdateAsync: ${diag.fetchResult}`,
    `reloadAsync: ${diag.reloadResult}`,
    "",
    `Updates.isEnabled: ${diag.updatesEnabled}`,
    `Updates.isEmergencyLaunch: ${diag.isEmergencyLaunch}`,
    `Updates.emergencyLaunchReason: ${diag.emergencyLaunchReason}`,
    `Updates.createdAt: ${diag.updateCreatedAt}`,
    `bundle source: ${diag.bundleSource}`,
    `commit (running): ${diag.commitHash}`,
    `deploy message: ${diag.deployMessage}`,
    `native checkError: ${diag.checkError}`,
    `native downloadError: ${diag.downloadError}`,
    `OTA_IDENTITY_FIX_VERSION: ${diag.otaIdentityFixVersion}`,
    `latestContext.isUpdatePending: ${diag.isUpdatePending}`,
    "",
    "--- banner identity trace (why App update ready shows) ---",
    ...diag.bannerTraceLines,
    "",
    ...(diag.attestation.caseId === "C" ? [diag.caseCNativeSafety, ""] : []),
    "--- expo-updates native logs (last hour) ---",
    ...diag.startupLogs,
    "",
    "--- JS launch OTA logs ---",
    ...(diag.jsLaunchLogs.length ? diag.jsLaunchLogs : ["(none)"]),
  ].join("\n");
}

export default function OtaDebugScreen() {
  return (
    <ErrorBoundary>
      <OtaDebugScreenInner />
    </ErrorBoundary>
  );
}

function OtaDebugScreenInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
        ...prev,
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
    void refresh();
  }, [refresh]);

  const copyAll = async () => {
    const snap = diag ?? (await refresh());
    if (!snap) return;
    await Clipboard.setStringAsync(buildReport(snap));
    setStatus("Copied full attestation report to clipboard");
  };

  const runCheckFetchReload = async () => {
    setBusy(true);
    setStatus("checkForUpdateAsync → fetchUpdateAsync → reloadAsync…");
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
    setBusy(false);
  };

  const embeddedWarning =
    diag.isEmbeddedLaunch && diag.updatesEnabled
      ? "Running embedded bundle. If check/fetch succeed but isEmbeddedLaunch stays true after force-reload, error recovery may be rolling back every launch."
      : null;

  const caseColor =
    diag.attestation.caseId === "A"
      ? "#86efac"
      : diag.attestation.caseId === "B"
        ? "#fde68a"
        : diag.attestation.caseId === "C"
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
            {diag.attestation.caseId} — {diag.attestation.label}
          </Text>
          <Text
            selectable
            style={{ color: "#e2e8f0", fontFamily: FONT.body, fontSize: 12, lineHeight: 18 }}
          >
            {diag.attestation.summary}
          </Text>
          <Text
            selectable
            style={{ color: "#94a3b8", fontFamily: FONT.body, fontSize: 12, lineHeight: 18 }}
          >
            Recovery: {diag.attestation.recoveryPath}
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
            Device attestation values
          </Text>
          <Row label="Updates.runtimeVersion" value={diag.runtimeVersion} />
          <Row label="Updates.updateId" value={diag.updateId} />
          <Row label="Updates.isEmbeddedLaunch" value={String(diag.isEmbeddedLaunch)} />
          <Row
            label="app version / CFBundleShortVersionString"
            value={diag.cfBundleShortVersion}
          />
          <Row label="native build number" value={diag.buildNumber} />
          <Row label="update channel" value={diag.channel} />
          <Row label="hasRnPurchasesNative (Case C signal)" value={String(diag.hasRnPurchasesNative)} />
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
          <Row label="runtimeVersion" value={diag.expectedHealthy.runtimeVersion} />
          <Row label="updateId" value={diag.expectedHealthy.updateId} />
          <Row
            label="isEmbeddedLaunch"
            value={String(diag.expectedHealthy.isEmbeddedLaunch)}
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
            value={String(diag.updateAvailable)}
          />
          <Row label="fetch succeeds" value={String(diag.fetchSucceeded)} />
          <Row label="reload/apply succeeds" value={String(diag.reloadSucceeded)} />
          <Row label="checkForUpdateAsync()" value={diag.checkResult} />
          <Row label="fetchUpdateAsync()" value={diag.fetchResult} />
          <Row label="reloadAsync()" value={diag.reloadResult} />
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
            value={String(diag.otaIdentityFixVersion)}
          />
          <Row
            label="running Updates.updateId"
            value={diag.bannerTrace?.runningUpdateId ?? diag.updateId}
          />
          <Row
            label="downloadedManifest.id"
            value={diag.bannerTrace?.downloadedUpdateId ?? "—"}
          />
          <Row
            label="check availableUpdateId"
            value={diag.bannerTrace?.availableUpdateIdFromCheck ?? "—"}
          />
          <Row
            label="persisted @stadium/ota-update-ready"
            value={diag.bannerTrace?.persistedReadyId ?? "—"}
          />
          <Row
            label="latestContext.isUpdatePending"
            value={String(diag.bannerTrace?.nativeIsUpdatePending ?? diag.isUpdatePending)}
          />
          <Row
            label="genuinelyPending (identity gate)"
            value={String(diag.bannerTrace?.genuinelyPending ?? "—")}
          />
          <Row
            label="bannerVisible"
            value={String(diag.bannerTrace?.bannerVisible ?? "—")}
          />
          <Row
            label="bannerExpression"
            value={diag.bannerTrace?.bannerExpression ?? "—"}
          />
          <Row
            label="recovery.pending / reloadTarget"
            value={`${diag.bannerTrace?.recoveryPending ?? "—"} / ${diag.bannerTrace?.recoveryReloadTargetId ?? "—"}`}
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
          <Row label="Updates.isEnabled" value={String(diag.updatesEnabled)} />
          <Row label="Updates.isEmergencyLaunch" value={String(diag.isEmergencyLaunch)} />
          <Row label="Updates.emergencyLaunchReason" value={diag.emergencyLaunchReason} />
          <Row label="Updates.createdAt" value={diag.updateCreatedAt} />
          <Row label="Bundle source" value={diag.bundleSource} />
          <Row label="Commit hash (running JS)" value={diag.commitHash} />
          <Row label="Deploy message" value={diag.deployMessage} />
          <Row label="native checkError" value={diag.checkError} />
          <Row label="native downloadError" value={diag.downloadError} />
        </View>

        {diag.attestation.caseId === "C" && diag.caseCNativeSafety ? (
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
              {diag.caseCNativeSafety}
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
            lines={diag.jsLaunchLogs.length ? diag.jsLaunchLogs : ["(none yet)"]}
          />
        </View>

        {status ? (
          <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 13 }}>{status}</Text>
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
