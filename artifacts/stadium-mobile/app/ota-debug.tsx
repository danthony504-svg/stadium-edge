import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { formatOtaLogLines } from "@/lib/otaLaunchLog";
import {
  formatCoachRequestTrace,
  loadCoachMarketPipelineAudit,
  loadCoachRequestTrace,
  type CoachRequestTrace,
} from "@/lib/coachRequestTrace";
import type { CoachMarketPipelineSnapshot } from "@/lib/coachMarketPipelineAudit";

const MAX_DISPLAY_LINES = 80;
const MAX_DISPLAY_CHARS = 500;

function initialDiagnostics(): OtaFullDiagnostics {
  return {
    ...readOtaDebugSnapshot(),
    checkResult: "loading…",
    fetchResult: "—",
    reloadResult: "—",
    startupLogs: ["loading native logs…"],
    jsLaunchLogs: formatOtaLogLines(),
  };
}

function safeLines(value: unknown, fallback: string): string[] {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return [fallback];
    const lines = text.split("\n").slice(0, MAX_DISPLAY_LINES);
    const bounded = lines.map((line) =>
      line.length > MAX_DISPLAY_CHARS ? `${line.slice(0, MAX_DISPLAY_CHARS)}…` : line,
    );
    return text.split("\n").length > MAX_DISPLAY_LINES
      ? [...bounded, `… ${MAX_DISPLAY_LINES}-line on-screen limit; use Copy for the complete record.`]
      : bounded;
  } catch (error) {
    return [`Unable to render diagnostic data: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function auditPreview(audit: CoachMarketPipelineSnapshot | null): Record<string, unknown> | string {
  if (!audit) return "No completed Coach market audit recorded yet.";
  const source = audit as Record<string, unknown>;
  return {
    requestId: source.requestId ?? "—",
    stages: source.stages ?? {},
    funnel: source.funnel ?? {},
    qualificationGateCounts: source.qualificationGateCounts ?? {},
    gameSimulations: Array.isArray(source.gameSimulations) ? source.gameSimulations.slice(0, 10) : [],
    nonPropRejections: Array.isArray(source.nonPropRejections) ? source.nonPropRejections.slice(0, 20) : [],
    qualifiedCandidates: Array.isArray(source.qualifiedCandidates) ? source.qualifiedCandidates.slice(0, 25) : [],
    finalization: source.finalization ?? null,
  };
}

function OtaDiagnosticsErrorFallback({ error }: ErrorFallbackProps) {
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#0b1220", gap: 10 }}>
      <Text style={{ color: "#f8fafc", fontSize: 20, fontWeight: "700" }}>OTA Diagnostics unavailable</Text>
      <Text style={{ color: "#94a3b8", fontSize: 14, lineHeight: 20 }}>
        This diagnostics-only screen encountered an error. The rest of Stadium Edge remains available.
      </Text>
      <Text numberOfLines={3} style={{ color: "#64748b", fontSize: 12, lineHeight: 18 }}>
        {error.message || "Unknown diagnostics error"}
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
    "=== Stadium Edge OTA Diagnostics ===",
    `Updates.isEnabled: ${diag.updatesEnabled}`,
    `Updates.isEmbeddedLaunch: ${diag.isEmbeddedLaunch}`,
    `Updates.isEmergencyLaunch: ${diag.isEmergencyLaunch}`,
    `Updates.emergencyLaunchReason: ${diag.emergencyLaunchReason}`,
    `Updates.updateId: ${diag.updateId}`,
    `Updates.runtimeVersion: ${diag.runtimeVersion}`,
    `Updates.channel: ${diag.channel}`,
    `Updates.createdAt: ${diag.updateCreatedAt}`,
    `Updates.checkAutomatically: ${diag.checkAutomatically}`,
    `fallbackToCacheTimeout: ${diag.fallbackToCacheTimeout}`,
    `Updates.launchDuration (ms): ${diag.launchDurationMs}`,
    `isUpdatePending: ${diag.isUpdatePending}`,
    `isStartupProcedureRunning: ${diag.isStartupProcedureRunning}`,
    `rollback.commitTime: ${diag.rollbackCommitTime}`,
    `native checkError: ${diag.checkError}`,
    `native downloadError: ${diag.downloadError}`,
    `bundle source: ${diag.bundleSource}`,
    `app version: ${diag.appVersion}`,
    `iOS build: ${diag.buildNumber}`,
    `commit (running): ${diag.commitHash}`,
    `deploy message: ${diag.deployMessage}`,
    `updates.url: ${diag.updateUrl}`,
    `requestHeaders: ${diag.requestHeaders}`,
    `projectId: ${diag.projectId}`,
    "",
    `checkForUpdateAsync: ${diag.checkResult}`,
    `fetchUpdateAsync: ${diag.fetchResult}`,
    `reloadAsync: ${diag.reloadResult}`,
    "",
    "--- expo-updates native logs (last hour) ---",
    ...diag.startupLogs,
    "",
    "--- JS launch OTA logs ---",
    ...(diag.jsLaunchLogs.length ? diag.jsLaunchLogs : ["(none)"]),
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
  const [diag, setDiag] = useState<OtaFullDiagnostics>(initialDiagnostics);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probeLoading, setProbeLoading] = useState(true);
  const [coachTrace, setCoachTrace] = useState<CoachRequestTrace | null>(null);
  const [marketAudit, setMarketAudit] = useState<CoachMarketPipelineSnapshot | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!mounted.current) return null;
    setProbeLoading(true);
    try {
      const next = await collectOtaFullDiagnostics();
      if (!mounted.current) return null;
      setDiag(next);
      console.log("OTA_DIAG_UPDATE_INFO_LOADED");
      const trace = await loadCoachRequestTrace();
      if (!mounted.current) return null;
      setCoachTrace(trace);
      console.log("OTA_DIAG_TRACE_LOADED");
      const audit = await loadCoachMarketPipelineAudit<CoachMarketPipelineSnapshot>();
      if (!mounted.current) return null;
      setMarketAudit(audit);
      console.log("OTA_DIAG_AUDIT_LOADED");
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDiag((prev) => ({
        ...prev,
        checkResult: `ERR: ${msg}`,
        fetchResult: "skipped (refresh failed)",
        reloadResult: "skipped",
        startupLogs: [`collectOtaFullDiagnostics ERR: ${msg}`],
      }));
      return null;
    } finally {
      if (mounted.current) setProbeLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log("OTA_DIAG_MOUNT");
    void refresh();
    console.log("OTA_DIAG_RENDER_COMPLETE");
    return () => {
      mounted.current = false;
      console.log("OTA_DIAG_UNMOUNT");
    };
  }, [refresh]);

  const copyAll = async () => {
    const snap = diag ?? (await refresh());
    await Clipboard.setStringAsync(buildReport(snap));
    if (mounted.current) setStatus("Copied full report to clipboard");
  };

  const copyCoachTrace = async () => {
    const trace = await loadCoachRequestTrace();
    if (mounted.current) setCoachTrace(trace);
    await Clipboard.setStringAsync(formatCoachRequestTrace(trace));
    if (mounted.current) setStatus("Copied Coach trace to clipboard");
  };

  const copyMarketAudit = async () => {
    const audit = await loadCoachMarketPipelineAudit<CoachMarketPipelineSnapshot>();
    if (mounted.current) setMarketAudit(audit);
    let report = "No completed Coach market audit recorded yet.";
    try {
      report = audit ? JSON.stringify(audit, null, 2) : report;
    } catch (error) {
      report = `Unable to copy Market Audit: ${error instanceof Error ? error.message : String(error)}`;
    }
    await Clipboard.setStringAsync(report);
    if (mounted.current) setStatus("Copied Market Audit to clipboard");
  };

  const runCheckFetchReload = async () => {
    setBusy(true);
    setStatus("checkForUpdateAsync → fetchUpdateAsync → reloadAsync…");
    try {
      const result = await forceOtaCheckFetchAndReload();
      if (result.reloaded) {
        if (mounted.current) setStatus(result.reloadResult ?? "Reloading into new bundle…");
        return;
      }
      const next = await refresh();
      if (next && mounted.current) setDiag(next);
      if (mounted.current) {
        setStatus(
          [result.reason, result.reloadResult].filter(Boolean).join(" · ") ||
            "Probe finished — see reloadAsync row",
        );
      }
    } catch (error) {
      if (mounted.current) {
        setStatus(`Update action failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const embeddedWarning =
    diag.isEmbeddedLaunch && diag.updatesEnabled
      ? "Running embedded bundle. If check/fetch succeed but isEmbeddedLaunch stays true after force-reload, error recovery may be rolling back every launch."
      : null;

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
          OTA Diagnostics
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
          Temporary deployment probe. Expected: runtime{" "}
          <Text style={{ fontFamily: FONT.semibold }}>1.0.0</Text>, channel{" "}
          <Text style={{ fontFamily: FONT.semibold }}>production</Text>, updates URL{" "}
          <Text style={{ fontFamily: FONT.semibold }}>u.expo.dev/9af36ab9-…</Text>.
          {probeLoading ? (
            <Text style={{ fontFamily: FONT.medium }}> Live probe still running…</Text>
          ) : null}
          {" "}
          Opening this screen only checks for updates — use the button below to download and restart.
        </Text>

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
            Running bundle (Updates.*)
          </Text>
          <Row label="Updates.isEnabled" value={String(diag.updatesEnabled)} />
          <Row label="Updates.isEmbeddedLaunch" value={String(diag.isEmbeddedLaunch)} />
          <Row label="Updates.isEmergencyLaunch" value={String(diag.isEmergencyLaunch)} />
          <Row label="Updates.emergencyLaunchReason" value={diag.emergencyLaunchReason} />
          <Row label="Updates.updateId" value={diag.updateId} />
          <Row label="Updates.runtimeVersion" value={diag.runtimeVersion} />
          <Row label="Updates.channel" value={diag.channel} />
          <Row label="Updates.createdAt" value={diag.updateCreatedAt} />
          <Row label="Updates.checkAutomatically (effective)" value={diag.checkAutomatically} />
          <Row label="fallbackToCacheTimeout (app.json)" value={String(diag.fallbackToCacheTimeout)} />
          <Row label="Updates.launchDuration (ms)" value={diag.launchDurationMs} />
          <Row label="Bundle source" value={diag.bundleSource} />
          <Row label="Commit hash (running JS)" value={diag.commitHash} />
          <Row label="Deploy message" value={diag.deployMessage} />
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Coach market pipeline audit
          </Text>
          <Row label="Completed request ID" value={marketAudit?.requestId ?? "—"} />
          <Pressable onPress={() => setShowAudit((visible) => !visible)}>
            <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 14 }}>
              {showAudit ? "Hide market audit preview" : "Show market audit preview (bounded)"}
            </Text>
          </Pressable>
          {showAudit ? (
            <LogBlock
              title="Completed board scan — bounded preview"
              lines={safeLines(auditPreview(marketAudit), "No completed Coach market audit recorded yet.")}
            />
          ) : null}
          <Pressable
            onPress={() => void copyMarketAudit()}
            style={({ pressed }) => ({
              paddingVertical: 10,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 14 }}>
              Copy Market Audit
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            Coach request trace
          </Text>
          <Pressable onPress={() => setShowTrace((visible) => !visible)}>
            <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 14 }}>
              {showTrace ? "Hide Coach trace preview" : "Show Coach trace preview (bounded)"}
            </Text>
          </Pressable>
          {showTrace ? (
            <LogBlock
              title="Most recent request (persisted on device)"
              lines={safeLines(formatCoachRequestTrace(coachTrace), "No Coach request trace recorded yet.")}
            />
          ) : null}
          <Pressable
            onPress={() => void copyCoachTrace()}
            style={({ pressed }) => ({
              paddingVertical: 10,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 14 }}>
              Copy Trace
            </Text>
          </Pressable>
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
            Native state machine
          </Text>
          <Row label="isUpdatePending" value={String(diag.isUpdatePending)} />
          <Row label="isDownloading" value={String(diag.isDownloading)} />
          <Row label="isStartupProcedureRunning" value={String(diag.isStartupProcedureRunning)} />
          <Row label="rollback.commitTime" value={diag.rollbackCommitTime} />
          <Row label="native checkError" value={diag.checkError} />
          <Row label="native downloadError" value={diag.downloadError} />
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
            Live probe (JS API)
          </Text>
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
            gap: 10,
          }}
        >
          <Row label="App version" value={diag.appVersion} />
          <Row label="iOS build number" value={diag.buildNumber} />
          <Row label="updates.url" value={diag.updateUrl} />
          <Row label="requestHeaders" value={diag.requestHeaders} />
          <Row label="Expo project ID" value={diag.projectId} />
        </View>

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
          <LogBlock title="expo-updates native logs (startup / error recovery)" lines={safeLines(diag.startupLogs, "(none yet)")} />
          <LogBlock title="JS OtaStartupGate / manual logs" lines={safeLines(diag.jsLaunchLogs.length ? diag.jsLaunchLogs : ["(none yet)"], "(none yet)")} />
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
              Refresh probe & logs
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
              Copy full report
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
