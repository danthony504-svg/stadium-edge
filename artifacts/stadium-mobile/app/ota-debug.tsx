import * as Clipboard from "expo-clipboard";
import * as Updates from "expo-updates";
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
import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import {
  forceOtaCheckAndFetch,
  readOtaDebugSnapshot,
  type OtaDebugSnapshot,
} from "@/lib/otaDebug";
import { clearSlatePreAnalysisCache } from "@/lib/slatePreAnalysisCache";

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
      `Build number: ${snap.buildNumber}`,
      `Runtime version: ${snap.runtimeVersion}`,
      `Update ID: ${snap.updateId}`,
      `Commit hash: ${snap.commitHash}`,
      `OTA channel: ${snap.channel}`,
      `Last update: ${snap.lastUpdateAt}`,
      `Updates enabled: ${snap.updatesEnabled}`,
      `Embedded launch: ${snap.isEmbeddedLaunch}`,
      `MLB fallback in bundle: ${snap.bundleHasMlbFallback}`,
      `Bundle stamp: ${snap.bundleFeatureStamp}`,
      `Update URL: ${snap.updateUrl}`,
      `Project ID: ${snap.projectId}`,
    ];
    await Clipboard.setStringAsync(lines.join("\n"));
    setStatus("Copied to clipboard");
  };

  const runCheck = async () => {
    setBusy(true);
    setStatus("Checking expo-updates…");
    const result = await forceOtaCheckAndFetch();
    refresh();
    if (result.isAvailable) {
      setStatus("Update downloaded — tap Reload to apply");
    } else {
      setStatus(result.reason ?? "No update available");
    }
    setBusy(false);
  };

  const reload = async () => {
    setBusy(true);
    try {
      await clearDiscoverCache();
      await clearSlatePreAnalysisCache();
      if (Updates.isEnabled) {
        await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
      }
    } finally {
      setBusy(false);
    }
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
          OTA Debug
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
          Temporary diagnostics for App Store OTA delivery. Expected runtime{" "}
          <Text style={{ fontFamily: FONT.semibold }}>1.0.0</Text>, channel{" "}
          <Text style={{ fontFamily: FONT.semibold }}>production</Text>, project{" "}
          <Text style={{ fontFamily: FONT.semibold }}>9af36ab9-f953-4879-9dd2-82807ef7430c</Text>.
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
          <Row label="Build number" value={snap.buildNumber} />
          <Row label="Runtime version" value={snap.runtimeVersion} />
          <Row label="Update ID" value={snap.updateId} />
          <Row label="Commit hash (bundle)" value={snap.commitHash} />
          <Row label="OTA channel" value={snap.channel} />
          <Row label="Last update timestamp" value={snap.lastUpdateAt} />
          <Row label="Updates enabled" value={String(snap.updatesEnabled)} />
          <Row label="Embedded launch" value={String(snap.isEmbeddedLaunch)} />
          <Row label="Update pending" value={String(snap.isUpdatePending)} />
          <Row label="Downloading" value={String(snap.isDownloading)} />
          <Row label="MLB ESPN fallback in bundle" value={String(snap.bundleHasMlbFallback)} />
          <Row label="Bundle stamp" value={snap.bundleFeatureStamp} />
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
                Check & download update
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void reload()}
            disabled={busy}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingVertical: 14,
              alignItems: "center",
              opacity: pressed || busy ? 0.85 : 1,
            })}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
              Reload app
            </Text>
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
              Refresh &amp; copy report
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
