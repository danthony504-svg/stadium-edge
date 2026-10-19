import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { shouldShowOtaHomeDiagnostics } from "@/lib/navMenuAuth";
import { FONT } from "@/components/ui";
import { tryGetExpoUpdates } from "@/lib/expoUpdatesAccess";
import { collectOtaStaticDiagnostics, type OtaFullDiagnostics } from "@/lib/otaDebug";
import {
  EXPECTED_HEALTHY_RUNTIME,
  formatChannelTipMatchLabel,
  formatOtaChannelStreamLabel,
} from "@/lib/otaDeviceAttestation";

/**
 * Temporary Home attestation strip — full report at Menu → Device attestation (/ota-debug).
 * Read-only; does not change Coach / OTA auto-apply behavior.
 *
 * Must NOT statically import expo-updates: Home is the cold-start tab, and
 * requireNativeModule during module eval (before DeferredOtaRuntime) has
 * contributed to updatePreviouslyFailed blacklists.
 */
export function OtaHomeDiagnostics() {
  const router = useRouter();
  const [diag, setDiag] = useState<OtaFullDiagnostics | null>(null);
  const Updates = tryGetExpoUpdates();

  useEffect(() => {
    let cancelled = false;
    // Static only — never auto-run checkForUpdateAsync / reloadAsync from Home.
    void collectOtaStaticDiagnostics().then((d) => {
      if (!cancelled) setDiag(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Updates?.isEnabled || !diag || !shouldShowOtaHomeDiagnostics(diag.channel, __DEV__)) return null;

  const caseColor =
    diag.attestation.caseId === "A"
      ? "#86efac"
      : diag.attestation.caseId === "B"
        ? "#fde68a"
        : diag.attestation.caseId === "C"
          ? "#fca5a5"
          : "#cbd5e1";

  const stream =
    diag.expectedHealthy?.channelStreamLabel ||
    formatOtaChannelStreamLabel(diag.channel);
  const tipMatch =
    diag.expectedHealthy?.tipMatchLabel ||
    formatChannelTipMatchLabel(diag.attestation.matchesChannelTip);
  const tipId = diag.expectedHealthy?.channelTipUpdateId?.trim() || "(not probed)";
  const recoveryPending = diag.bannerTrace?.recoveryPending;
  const failedLedger = (diag.failedLaunchLedgerLines ?? [])
    .filter((l) => l && !/no failed-launch|loading|unavailable/i.test(l))
    .slice(0, 2);

  const lines: [string, string][] = [
    ["CHANNEL STREAM", stream],
    ["CASE", `${diag.attestation.caseId} — ${diag.attestation.label}`],
    ["Updates.runtimeVersion", diag.runtimeVersion],
    ["Updates.updateId (running)", diag.updateId],
    ["Updates.isEmbeddedLaunch", String(diag.isEmbeddedLaunch)],
    ["update channel", diag.channel],
    ["equals channel tip?", tipMatch],
    ["known channel tip updateId", tipId],
    ["bundle source", diag.bundleSource],
    ["recovery pending", String(recoveryPending ?? "—")],
    ["emergency launch", String(diag.isEmergencyLaunch)],
    [
      "emergency reason",
      diag.emergencyLaunchReason && diag.emergencyLaunchReason !== "—"
        ? diag.emergencyLaunchReason
        : "—",
    ],
    ["CFBundleShortVersionString", diag.cfBundleShortVersion],
    ["native build", diag.buildNumber],
    ["healthy runtime target", EXPECTED_HEALTHY_RUNTIME],
  ];

  return (
    <Pressable
      onPress={() => router.push("/ota-debug")}
      style={{
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        padding: 10,
        backgroundColor: "rgba(30,41,59,0.95)",
        borderWidth: 1,
        borderColor: caseColor,
        borderRadius: 8,
      }}
    >
      <Text
        style={{
          color: "#f8fafc",
          fontFamily: FONT.semibold,
          fontSize: 11,
          marginBottom: 4,
        }}
      >
        Device attestation · {stream} (tap for full report)
      </Text>
      <Text
        selectable
        style={{
          color: caseColor,
          fontFamily: FONT.medium,
          fontSize: 10,
          lineHeight: 14,
          marginBottom: 6,
        }}
      >
        {diag.attestation.summary}
      </Text>
      {lines.map(([label, value]) => (
        <Text
          key={label}
          selectable
          style={{
            color: "#94a3b8",
            fontFamily: FONT.body,
            fontSize: 9,
            lineHeight: 13,
          }}
        >
          {label}: {value}
        </Text>
      ))}
      {failedLedger.length ? (
        <Text
          selectable
          style={{
            color: "#fca5a5",
            fontFamily: FONT.body,
            fontSize: 9,
            lineHeight: 13,
            marginTop: 4,
          }}
        >
          failed-launch ledger: {failedLedger.join(" | ")}
        </Text>
      ) : (
        <Text
          selectable
          style={{
            color: "#64748b",
            fontFamily: FONT.body,
            fontSize: 9,
            lineHeight: 13,
            marginTop: 4,
          }}
        >
          failed-launch ledger: (none)
        </Text>
      )}
      <Text
        selectable
        style={{
          color: "#64748b",
          fontFamily: FONT.body,
          fontSize: 9,
          lineHeight: 13,
          marginTop: 6,
        }}
      >
        Recovery: {diag.attestation.recoveryPath}
      </Text>
    </Pressable>
  );
}
