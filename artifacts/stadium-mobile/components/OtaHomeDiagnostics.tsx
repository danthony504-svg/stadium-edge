import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { tryGetExpoUpdates } from "@/lib/expoUpdatesAccess";
import {
  formatLastStartupFatalLines,
  readLastStartupFatal,
  tryAsyncStorageLastFatal,
  type LastStartupFatal,
} from "@/lib/lastStartupFatal";
import { collectOtaStaticDiagnostics, type OtaFullDiagnostics } from "@/lib/otaDebug";
import {
  EXPECTED_HEALTHY_RUNTIME,
  EXPECTED_HEALTHY_UPDATE_ID,
} from "@/lib/otaDeviceAttestation";

/**
 * Temporary Home attestation strip — full report at Menu → Device attestation (/ota-debug).
 * Read-only; does not change Coach / OTA auto-apply behavior.
 *
 * Also surfaces the last captured JS fatal + Copy so a phone without Mac /
 * Console / working Diagnostics can still report the exact exception.
 *
 * Must NOT statically import expo-updates: Home is the cold-start tab, and
 * requireNativeModule during module eval (before DeferredOtaRuntime) has
 * contributed to updatePreviouslyFailed blacklists.
 */
export function OtaHomeDiagnostics() {
  const router = useRouter();
  const [diag, setDiag] = useState<OtaFullDiagnostics | null>(null);
  const [lastFatal, setLastFatal] = useState<LastStartupFatal | null>(null);
  const [copied, setCopied] = useState(false);
  const Updates = tryGetExpoUpdates();

  useEffect(() => {
    if (__DEV__) return;
    let cancelled = false;
    // Static only — never auto-run checkForUpdateAsync / reloadAsync from Home.
    void collectOtaStaticDiagnostics().then((d) => {
      if (!cancelled) setDiag(d);
    });
    void (async () => {
      try {
        const storage = tryAsyncStorageLastFatal();
        const fatal = storage
          ? await readLastStartupFatal(storage)
          : null;
        if (!cancelled) setLastFatal(fatal);
      } catch {
        if (!cancelled) setLastFatal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (__DEV__ || !Updates?.isEnabled) return null;
  if (!diag && !lastFatal) return null;

  const caseColor =
    diag?.attestation.caseId === "A"
      ? "#86efac"
      : diag?.attestation.caseId === "B"
        ? "#fde68a"
        : diag?.attestation.caseId === "C"
          ? "#fca5a5"
          : "#cbd5e1";

  const fatalLines = formatLastStartupFatalLines(lastFatal);
  const lines: [string, string][] = diag
    ? [
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
      ]
    : [];

  const copyPayload = [
    "Stadium Edge — Home OTA readout (no Diagnostics required)",
    ...fatalLines,
    "",
    ...(diag
      ? [
          diag.attestation.summary,
          ...lines.map(([label, value]) => `${label}: ${value}`),
          `Recovery: ${diag.attestation.recoveryPath}`,
          "",
          "failed-launch ledger:",
          ...(diag.failedLaunchLedgerLines ?? []),
        ]
      : ["(attestation snapshot unavailable)")],
  ].join("\n");

  const onCopy = () => {
    void Clipboard.setStringAsync(copyPayload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        padding: 10,
        backgroundColor: "rgba(30,41,59,0.95)",
        borderWidth: 1,
        borderColor: lastFatal?.message ? "#fca5a5" : caseColor,
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
        Device attestation (Home copy — Diagnostics optional)
      </Text>
      <Text
        selectable
        style={{
          color: lastFatal?.message ? "#fecaca" : "#94a3b8",
          fontFamily: FONT.medium,
          fontSize: 10,
          lineHeight: 14,
          marginBottom: 6,
        }}
      >
        {fatalLines.join("\n")}
      </Text>
      {diag ? (
        <>
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
        </>
      ) : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
        <Pressable onPress={onCopy} hitSlop={8}>
          <Text
            style={{
              color: "#93c5fd",
              fontFamily: FONT.semibold,
              fontSize: 11,
            }}
          >
            {copied ? "Copied" : "Copy fatal + attestation"}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push("/ota-debug")} hitSlop={8}>
          <Text
            style={{
              color: "#64748b",
              fontFamily: FONT.body,
              fontSize: 11,
            }}
          >
            Open full report
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
