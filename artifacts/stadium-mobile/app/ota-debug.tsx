import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  forceOtaCheckFetchAndReload,
  readOtaDebugSnapshot,
  type OtaDebugSnapshot,
} from "@/lib/otaDebug";

function Row({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        {label}
      </Text>
      <Text
        selectable
        style={{ color: colors.foreground, fontFamily: FONT.body, fontSize: 14, lineHeight: 20 }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function OtaDebugScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [snap, setSnap] = useState<OtaDebugSnapshot>(() => readOtaDebugSnapshot());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setSnap(readOtaDebugSnapshot());
  }, []);

  const copyAll = async () => {
    const lines = [
      `App version: ${snap.appVersion}`,
      `iOS build number: ${snap.buildNumber}`,
      `Runtime version: ${snap.runtimeVersion}`,
      `Channel: ${snap.channel}`,
      `Update ID: ${snap.updateId}`,
      `Commit hash: ${snap.commitHash}`,
      `Update created: ${snap.updateCreatedAt}`,
      `Bundle source: ${snap.bundleSource}`,
      `Updates enabled: ${snap.updatesEnabled}`,
      `Deploy message: ${snap.deployMessage}`,
      `Update URL: ${snap.updateUrl}`,
      `Project ID: ${snap.projectId}`,
    ];
    await Clipboard.setStringAsync(lines.join("\n"));
    setStatus("Copied to clipboard");
  };

  const runCheck = async () => {
    setBusy(true);
    setStatus("checkForUpdateAsync → fetchUpdateAsync → reloadAsync…");
    const result = await forceOtaCheckFetchAndReload();
    if (result.reloaded) {
      setStatus("Reloading into new bundle…");
      return;
    }
    refresh();
    setStatus(result.reason ?? "No update available");
    setBusy(false);
  };

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
          Deployment verification only. Expected: runtime <Text style={{ fontFamily: FONT.semibold }}>1.0.0</Text>, channel{" "}
          <Text style={{ fontFamily: FONT.semibold }}>production</Text>, project{" "}
          <Text style={{ fontFamily: FONT.semibold }}>9af36ab9-f953-4879-9dd2-82807ef7430c</Text>.
          App Store build <Text style={{ fontFamily: FONT.semibold }}>#62</Text> (1.0.2) is the last known production submit.
        </Text>

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
          <Row label="App version" value={snap.appVersion} />
          <Row label="iOS build number" value={snap.buildNumber} />
          <Row label="Runtime version" value={snap.runtimeVersion} />
          <Row label="Channel" value={snap.channel} />
          <Row label="Update ID" value={snap.updateId} />
          <Row label="Commit hash (running bundle)" value={snap.commitHash} />
          <Row label="Update creation date" value={snap.updateCreatedAt} />
          <Row label="Bundle source" value={snap.bundleSource} />
          <Row label="Updates enabled" value={String(snap.updatesEnabled)} />
          <Row label="Update pending" value={String(snap.isUpdatePending)} />
          <Row label="Deploy message" value={snap.deployMessage} />
          <Row label="Update URL" value={snap.updateUrl} />
          <Row label="Expo project ID" value={snap.projectId} />
        </View>

        {status ? (
          <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 13 }}>{status}</Text>
        ) : null}

        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => void runCheck()}
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
            onPress={() => {
              refresh();
              void copyAll();
            }}
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 14 }}>
              Refresh & copy report
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
