import { Feather } from "@expo/vector-icons";
import { addUpdatesStateChangeListener } from "expo-updates";
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
import { useColors } from "@/hooks/useColors";
import { readOtaDebugSnapshot } from "@/lib/otaDebug";
import {
  manualCheckForUpdate,
  manualDownloadUpdate,
  manualRestartToApplyUpdate,
  readOtaPendingState,
} from "@/lib/otaManual";

type StepStatus = "idle" | "working" | "done" | "error";

function ActionButton({
  label,
  sublabel,
  icon,
  onPress,
  disabled,
  loading,
  colors,
}: {
  label: string;
  sublabel: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        padding: 16,
        opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Feather name={icon} size={18} color={colors.primary} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}>
          {label}
        </Text>
        <Text
          style={{
            fontFamily: FONT.body,
            fontSize: 13,
            color: colors.mutedForeground,
            lineHeight: 18,
          }}
        >
          {sublabel}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function AppUpdateScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const snap = readOtaDebugSnapshot();
  const [pending, setPending] = useState(readOtaPendingState);
  const [checkStatus, setCheckStatus] = useState<StepStatus>("idle");
  const [downloadStatus, setDownloadStatus] = useState<StepStatus>("idle");
  const [restartStatus, setRestartStatus] = useState<StepStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const sub = addUpdatesStateChangeListener((event) => {
      setPending({
        isUpdatePending: !!event.context.isUpdatePending,
        isDownloading: !!event.context.isDownloading,
      });
    });
    return () => sub.remove();
  }, []);

  const onCheck = useCallback(async () => {
    setCheckStatus("working");
    setMessage(null);
    const result = await manualCheckForUpdate();
    setCheckStatus(result.available ? "done" : "error");
    setMessage(result.reason);
  }, []);

  const onDownload = useCallback(async () => {
    setDownloadStatus("working");
    setMessage(null);
    const result = await manualDownloadUpdate();
    setPending(readOtaPendingState());
    setDownloadStatus(result.isUpdatePending ? "done" : "error");
    setMessage(result.reason);
  }, []);

  const onRestart = useCallback(async () => {
    setRestartStatus("working");
    setMessage(null);
    const result = await manualRestartToApplyUpdate();
    if (!result.restarted) {
      setRestartStatus("error");
      setMessage(result.reason);
    }
  }, []);

  const shortId =
    snap.updateId.length > 12 ? `${snap.updateId.slice(0, 8)}…` : snap.updateId;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          paddingBottom: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontFamily: FONT.display, fontSize: 24, color: colors.foreground }}>
          App update
        </Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/account"))}
          hitSlop={12}
          accessibilityLabel="Close"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 16 }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            padding: 16,
            gap: 8,
          }}
        >
          <Text style={{ fontFamily: FONT.semibold, fontSize: 15, color: colors.foreground }}>
            Current bundle
          </Text>
          <Text style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground }}>
            v{snap.appVersion} · runtime {snap.runtimeVersion} · {snap.bundleSource}
          </Text>
          <Text
            selectable
            style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}
          >
            channel {snap.channel} · update {shortId}
          </Text>
          <Text style={{ fontFamily: FONT.body, fontSize: 12, color: colors.mutedForeground }}>
            Updates check in the background on launch (ON_LOAD). Downloaded updates apply on the
            next normal launch — or tap Restart below after downloading.
          </Text>
          {pending.isDownloading ? (
            <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.primary }}>
              Background download in progress…
            </Text>
          ) : null}
          {pending.isUpdatePending ? (
            <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.primary }}>
              Update ready — tap Restart now to apply.
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          <ActionButton
            colors={colors}
            label="Check for update"
            sublabel="Ask Expo if a newer bundle exists for this build"
            icon="search"
            onPress={onCheck}
            loading={checkStatus === "working"}
          />
          <ActionButton
            colors={colors}
            label="Download update"
            sublabel="Fetch the update without restarting"
            icon="download"
            onPress={onDownload}
            loading={downloadStatus === "working"}
          />
          <ActionButton
            colors={colors}
            label="Restart now"
            sublabel="Apply a downloaded update immediately"
            icon="refresh-cw"
            onPress={onRestart}
            disabled={!pending.isUpdatePending}
            loading={restartStatus === "working"}
          />
        </View>

        {message ? (
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 13,
              color: checkStatus === "error" || downloadStatus === "error" || restartStatus === "error"
                ? colors.destructive
                : colors.mutedForeground,
              lineHeight: 19,
            }}
          >
            {message}
          </Text>
        ) : null}

        <Pressable
          onPress={() => router.push("/ota-debug")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 12,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Feather name="tool" size={15} color={colors.mutedForeground} />
          <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: colors.mutedForeground }}>
            Advanced OTA diagnostics
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
