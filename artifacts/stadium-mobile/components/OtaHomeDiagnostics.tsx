import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { tryGetExpoUpdates } from "@/lib/expoUpdatesAccess";
import { shouldShowDeviceAttestationUi } from "@/lib/navMenuAuth";
import { resolveOtaChannelForUi } from "@/lib/otaChannelUi";
import { collectOtaStaticDiagnostics, type OtaFullDiagnostics } from "@/lib/otaDebug";
import {
  EXPECTED_HEALTHY_RUNTIME,
  EXPECTED_HEALTHY_UPDATE_ID,
} from "@/lib/otaDeviceAttestation";

/**
 * Temporary Home attestation strip — full report at Menu → Device attestation (/ota-debug).
 * Preview / development only; hidden on the production channel (returns null — no gap).
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
  const visible = shouldShowDeviceAttestationUi({
    isDev: __DEV__,
    channel: resolveOtaChannelForUi(),
  });

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    // Static only — never auto-run checkForUpdateAsync / reloadAsync from Home.
    void collectOtaStaticDiagnostics().then((d) => {
      if (!cancelled) setDiag(d);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Null render → no Home spacing on production.
  if (!visible || !Updates?.isEnabled || !diag) return null;

  const caseColor =
    diag.attestation.caseId === "A"
      ? "#86efac"
      : diag.attestation.caseId === "B"
        ? "#fde68a"
        : diag.attestation.caseId === "C"
          ? "#fca5a5"
          : "#cbd5e1";

  const lines: [string, string][] = [
    ["CASE", `${diag.attestation.caseId} — ${diag.attestation.label}`],
    ["Updates.runtimeVersion", diag.runtimeVersion],
    ["Updates.updateId", diag.updateId],
    ["Updates.isEmbeddedLaunch", String(diag.isEmbeddedLaunch)],
    ["CFBundleShortVersionString", diag.cfBundleShortVersion],
    ["native build", diag.buildNumber],
    ["channel", diag.channel],
    ["update available?", String(diag.updateAvailable)],
    ["fetch succeeds?", String(diag.fetchSucceeded)],
    ["reload/apply succeeds?", String(diag.reloadSucceeded)],
    ["hasRnPurchasesNative", String(diag.hasRnPurchasesNative)],
    ["expected runtime", EXPECTED_HEALTHY_RUNTIME],
    ["expected updateId", EXPECTED_HEALTHY_UPDATE_ID],
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
        Device attestation (tap for full report)
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
