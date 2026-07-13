import { useRouter } from "expo-router";
import * as Updates from "expo-updates";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { collectOtaFullDiagnostics, type OtaFullDiagnostics } from "@/lib/otaDebug";

/**
 * Compact Home OTA strip — full report at Menu → OTA Diagnostics (/ota-debug).
 */
export function OtaHomeDiagnostics() {
  const router = useRouter();
  const [diag, setDiag] = useState<OtaFullDiagnostics | null>(null);

  useEffect(() => {
    if (__DEV__) return;
    let cancelled = false;
    void collectOtaFullDiagnostics().then((d) => {
      if (!cancelled) setDiag(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (__DEV__ || !Updates.isEnabled || !diag) return null;

  const lines: [string, string][] = [
    ["isEmbeddedLaunch", String(diag.isEmbeddedLaunch)],
    ["updateId", diag.updateId],
    ["runtimeVersion", diag.runtimeVersion],
    ["channel", diag.channel],
    ["createdAt", diag.updateCreatedAt],
    ["checkForUpdateAsync", diag.checkResult],
    ["fetchUpdateAsync", diag.fetchResult],
    ["reloadAsync", diag.reloadResult],
    ["isEmergencyLaunch", String(diag.isEmergencyLaunch)],
    ["startup log lines", String(diag.startupLogs.length)],
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
        borderColor: "#475569",
        borderRadius: 8,
      }}
    >
      <Text
        style={{
          color: "#f8fafc",
          fontFamily: FONT.semibold,
          fontSize: 11,
          marginBottom: 6,
        }}
      >
        OTA diagnostics (tap for full report)
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
    </Pressable>
  );
}
