import * as Updates from "expo-updates";
import { addUpdatesStateChangeListener, latestContext } from "expo-updates";
import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { isGenuinelyPendingOtaUpdate } from "@/lib/otaUpdateIdentity";

type OtaUiState = { isUpdatePending: boolean; isDownloading: boolean };

function downloadedIdFromContext(ctx: typeof latestContext): string | null {
  const id = (ctx?.downloadedManifest as { id?: string } | null | undefined)?.id;
  return id ? String(id) : null;
}

function otaUiFromContext(ctx: typeof latestContext): OtaUiState {
  const runningUpdateId = Updates.updateId ? String(Updates.updateId) : null;
  const downloadedUpdateId = downloadedIdFromContext(ctx);
  const isDownloading = !!ctx?.isDownloading;
  // Native isUpdatePending alone loops after reload when downloaded id ===
  // running id. Only show "ready" for a genuinely newer downloaded update.
  const isUpdatePending = isGenuinelyPendingOtaUpdate({
    runningUpdateId,
    downloadedUpdateId,
    isUpdatePending: !!ctx?.isUpdatePending,
  });
  return { isUpdatePending, isDownloading };
}

/**
 * Prompts the user when a prefetched OTA is ready — one tap applies it.
 * Uses the updates event listener instead of Updates.useUpdates() so a corrupt
 * mid-session bundle cannot brick the app via a broken hook export.
 */
export function OtaUpdateBanner() {
  const insets = useSafeAreaInsets();
  const [ota, setOta] = useState<OtaUiState>(() => otaUiFromContext(latestContext));

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    // Reconcile once on mount — latestContext may still say pending for the
    // update we just reloaded into.
    setOta(otaUiFromContext(latestContext));
    const sub = addUpdatesStateChangeListener((event) => {
      setOta(otaUiFromContext(event.context));
    });
    return () => sub.remove();
  }, []);

  if (__DEV__ || !Updates.isEnabled) return null;
  if (!ota.isUpdatePending && !ota.isDownloading) return null;

  const apply = () => {
    void Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: insets.top + 4,
        zIndex: 10000,
        alignItems: "center",
        paddingHorizontal: 12,
      }}
    >
      <Pressable
        onPress={ota.isUpdatePending ? apply : undefined}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: "#1d4ed8",
          borderRadius: 12,
          paddingVertical: 10,
          paddingHorizontal: 14,
          maxWidth: 420,
          width: "100%",
          opacity: pressed && ota.isUpdatePending ? 0.9 : 1,
        })}
      >
        <Feather name={ota.isUpdatePending ? "download" : "refresh-cw"} size={16} color="#fff" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 13 }}>
            {ota.isUpdatePending ? "App update ready" : "Downloading update…"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontFamily: FONT.medium, fontSize: 11 }}>
            {ota.isUpdatePending
              ? "Tap to restart and load the latest Discover + Coach fixes."
              : "Keep the app open for a moment."}
          </Text>
        </View>
        {ota.isUpdatePending ? (
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 12 }}>Restart</Text>
        ) : null}
      </Pressable>
    </View>
  );
}
