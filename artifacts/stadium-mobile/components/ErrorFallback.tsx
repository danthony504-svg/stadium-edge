import Feather from "@expo/vector-icons/Feather";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  formatCrashDiagnosticReport,
  sanitizeCrashText,
  type CrashOtaIdentity,
} from "@/lib/crashDiagnostics";
import { looksLikeCorruptOtaBundle } from "@/lib/otaCorruptBundle";

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
  /** React component stack from componentDidCatch — optional for nested fallbacks. */
  componentStack?: string | null;
};

async function loadFailedLaunchFlags(runningUpdateId: string): Promise<{
  updatePreviouslyFailed: boolean;
  failedLaunchCount: number;
}> {
  try {
    // Dynamic imports only — ErrorFallback must not pull these into root eval.
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const {
      OTA_FAILED_LAUNCH_KEY,
      readFailedLaunchRecord,
      isUpdatePreviouslyFailed,
      failedLaunchCount,
    } = await import("@/lib/otaFailedLaunch");
    const { readOtaRecoverySnapshot } = await import("@/lib/otaRecoveryState");
    const storage = {
      read: () => AsyncStorage.getItem(OTA_FAILED_LAUNCH_KEY),
    };
    const record = await readFailedLaunchRecord(storage);
    const recovery = readOtaRecoverySnapshot();
    const id = runningUpdateId && runningUpdateId !== "—" && runningUpdateId !== "embedded"
      ? runningUpdateId
      : "";
    const count = id
      ? failedLaunchCount(record, id)
      : Object.values(record.failures ?? {}).reduce((n, e) => Math.max(n, e?.count ?? 0), 0);
    const previously =
      recovery.updatePreviouslyFailed ||
      (id ? isUpdatePreviouslyFailed(record, id) : count > 0) ||
      !!record.pendingTargetId;
    return {
      updatePreviouslyFailed: previously,
      failedLaunchCount: Math.max(count, recovery.failedLaunchCount || 0),
    };
  } catch {
    return { updatePreviouslyFailed: false, failedLaunchCount: 0 };
  }
}

async function loadCrashOtaIdentity(): Promise<CrashOtaIdentity> {
  try {
    // Dynamic import keeps expo-updates out of the root static evaluation graph.
    const Updates = await import("expo-updates");
    let channelHeader: string | undefined;
    try {
      const Constants = (await import("expo-constants")).default;
      const hdr = Constants?.expoConfig?.updates?.requestHeaders?.["expo-channel-name"];
      if (typeof hdr === "string" && hdr.trim()) channelHeader = hdr.trim();
    } catch {
      // Constants optional — Updates.channel is enough when present.
    }
    const channel =
      (Updates.channel && String(Updates.channel)) || channelHeader || "—";
    const isEmbeddedLaunch = !!Updates.isEmbeddedLaunch;
    const bundleSource: CrashOtaIdentity["bundleSource"] = !Updates.isEnabled
      ? "unknown"
      : isEmbeddedLaunch
        ? "embedded"
        : "ota";
    const updateId = Updates.updateId
      ? String(Updates.updateId)
      : isEmbeddedLaunch
        ? "embedded"
        : "—";
    const failed = await loadFailedLaunchFlags(updateId);
    return {
      updateId,
      runtimeVersion: Updates.runtimeVersion ? String(Updates.runtimeVersion) : "—",
      channel,
      bundleSource,
      isEmbeddedLaunch,
      isEmergencyLaunch: !!Updates.isEmergencyLaunch,
      updatePreviouslyFailed: failed.updatePreviouslyFailed,
      failedLaunchCount: failed.failedLaunchCount,
    };
  } catch {
    return {
      updateId: "—",
      runtimeVersion: "—",
      channel: "—",
      bundleSource: "unknown",
      isEmbeddedLaunch: true,
      isEmergencyLaunch: false,
      updatePreviouslyFailed: false,
      failedLaunchCount: 0,
    };
  }
}

export function ErrorFallback({ error, resetError, componentStack }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const corruptBundle = looksLikeCorruptOtaBundle(error.message);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [ota, setOta] = useState<CrashOtaIdentity | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCrashOtaIdentity().then((id) => {
      if (!cancelled) setOta(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Loaded on tap, not at import time: this component sits in the root bundle's
  // static graph, and expo-updates must not be evaluated during startup.
  const handleRestart = async () => {
    if (corruptBundle) return;
    try {
      const Updates = await import("expo-updates");
      const { clearDiscoverCache } = await import("@/lib/discoverSessionCache");
      const { clearSlatePreAnalysisCache } = await import("@/lib/slatePreAnalysisCache");
      await clearDiscoverCache();
      await clearSlatePreAnalysisCache();
      if (Updates.isEnabled) {
        // Never resetError() in production — that reopens the same in-memory JS.
        // Always reload through expo-updates so a fetched OTA bundle is used.
        try {
          const check = await Updates.checkForUpdateAsync();
          if (check.isAvailable) {
            await Updates.fetchUpdateAsync();
          }
        } catch {
          // still attempt reload
        }
        await Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
      } else if (__DEV__) {
        resetError();
      }
    } catch {
      if (__DEV__) resetError();
    }
  };

  const report = formatCrashDiagnosticReport({
    errorMessage: error.message,
    errorStack: error.stack,
    componentStack,
    ota,
  });

  const copyDiagnostics = async () => {
    try {
      await Clipboard.setStringAsync(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — text below remains selectable.
    }
  };

  const formatErrorDetails = (): string => report;

  const monoFont = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Pressable
        onPress={() => setIsModalVisible(true)}
        accessibilityLabel="View crash diagnostics"
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.topButton,
          {
            top: insets.top + 16,
            backgroundColor: colors.card,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Feather name="alert-circle" size={20} color={colors.foreground} />
      </Pressable>

      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Something went wrong
        </Text>

        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          Please reload the app to continue.
        </Text>

        {error.message ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
              fontSize: 11,
              lineHeight: 16,
              textAlign: "center",
              opacity: 0.75,
            }}
            numberOfLines={4}
          >
            {sanitizeCrashText(error.message, 280)}
          </Text>
        ) : null}

        <View
          style={{
            width: "100%",
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            padding: 12,
            gap: 4,
          }}
        >
          <Text
            selectable
            style={{
              color: colors.mutedForeground,
              fontFamily: monoFont,
              fontSize: 11,
              lineHeight: 16,
            }}
          >
            {`updateId: ${ota?.updateId ?? "…"}`}
          </Text>
          <Text
            selectable
            style={{
              color: colors.mutedForeground,
              fontFamily: monoFont,
              fontSize: 11,
              lineHeight: 16,
            }}
          >
            {`runtime: ${ota?.runtimeVersion ?? "…"} · channel: ${ota?.channel ?? "…"}`}
          </Text>
          <Text
            selectable
            style={{
              color: colors.mutedForeground,
              fontFamily: monoFont,
              fontSize: 11,
              lineHeight: 16,
            }}
          >
            {`isEmbeddedLaunch: ${ota ? String(ota.isEmbeddedLaunch) : "…"} · bundle: ${ota?.bundleSource ?? "…"}${ota?.isEmergencyLaunch ? " · emergency" : ""}`}
          </Text>
          <Text
            selectable
            style={{
              color: colors.mutedForeground,
              fontFamily: monoFont,
              fontSize: 11,
              lineHeight: 16,
            }}
          >
            {`updatePreviouslyFailed: ${ota ? String(ota.updatePreviouslyFailed) : "…"} (${ota?.failedLaunchCount ?? "…"})`}
          </Text>
        </View>

        {corruptBundle ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.medium,
              fontSize: 13,
              lineHeight: 19,
              textAlign: "center",
              marginTop: 4,
            }}
          >
            A mixed app update is cached on this device (not a Coach or Home bug).
            Delete Stadium Edge, reinstall from the App Store, then reopen once. Do not
            use Try Again — it downloads another partial bundle and makes this worse.
          </Text>
        ) : null}

        <Pressable
          onPress={copyDiagnostics}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.secondary,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.secondaryForeground }]}>
            {copied ? "Copied" : "Copy Diagnostics"}
          </Text>
        </Pressable>

        {!corruptBundle ? (
          <Pressable
            onPress={handleRestart}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: colors.primaryForeground },
              ]}
            >
              Try Again
            </Text>
          </Pressable>
        ) : (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.medium,
              fontSize: 14,
              lineHeight: 20,
              textAlign: "center",
              marginTop: 8,
            }}
          >
            Reinstall from the App Store to recover.
          </Text>
        )}
      </View>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContainer,
              { backgroundColor: colors.background },
            ]}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                Crash Diagnostics
              </Text>
              <Pressable
                onPress={() => setIsModalVisible(false)}
                accessibilityLabel="Close crash diagnostics"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.closeButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather name="x" size={24} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalScrollView}
              contentContainerStyle={[
                styles.modalScrollContent,
                { paddingBottom: insets.bottom + 16 },
              ]}
              showsVerticalScrollIndicator
            >
              <View
                style={[
                  styles.errorContainer,
                  { backgroundColor: colors.card },
                ]}
              >
                <Text
                  style={[
                    styles.errorText,
                    {
                      color: colors.foreground,
                      fontFamily: monoFont,
                    },
                  ]}
                  selectable
                >
                  {formatErrorDetails()}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    width: "100%",
    maxWidth: 600,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 40,
  },
  message: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  topButton: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 8,
    paddingHorizontal: 24,
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    fontWeight: "600",
    textAlign: "center",
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    width: "100%",
    height: "90%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
  },
  errorContainer: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    padding: 16,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    width: "100%",
  },
});
