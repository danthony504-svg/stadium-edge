import * as Updates from "expo-updates";
import { addUpdatesStateChangeListener, latestContext } from "expo-updates";
import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { clearDiscoverCache } from "@/lib/discoverSessionCache";
import { applyOtaUpdateIfAvailable } from "@/lib/otaUpdater";

type OtaUiState = { isUpdatePending: boolean; isDownloading: boolean };

function otaUiFromContext(ctx: typeof latestContext): OtaUiState {
  return {
    isUpdatePending: !!ctx?.isUpdatePending,
    isDownloading: !!ctx?.isDownloading,
  };
}

/**
 * Prompts the user when a prefetched OTA is ready — one tap applies it.
 * On embedded TestFlight JS, auto-downloads the Discover Home OTA on mount.
 */
export function OtaUpdateBanner() {
  const insets = useSafeAreaInsets();
  const [ota, setOta] = useState<OtaUiState>(() => otaUiFromContext(latestContext));
  const [onEmbedded, setOnEmbedded] = useState(
    () => !__DEV__ && Updates.isEnabled && Updates.isEmbeddedLaunch,
  );

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    const sub = addUpdatesStateChangeListener((event) => {
      setOta(otaUiFromContext(event.context));
    });
    return () => sub.remove();
  }, []);

  // Embedded rollback lands on old Player Props — prefetch Discover OTA immediately.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled || !onEmbedded) return;
    void (async () => {
      try {
        await applyOtaUpdateIfAvailable();
        setOta(otaUiFromContext(latestContext));
      } catch {
        // offline — banner stays tappable
      }
    })();
  }, [onEmbedded]);

  if (__DEV__ || !Updates.isEnabled) return null;

  const showEmbeddedBanner = onEmbedded && !ota.isUpdatePending;
  if (!showEmbeddedBanner && !ota.isUpdatePending && !ota.isDownloading) return null;

  const apply = () => {
    void clearDiscoverCache().finally(() => {
      void Updates.reloadAsync({ reloadScreenOptions: { fade: true } });
    });
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
        onPress={
          ota.isUpdatePending
            ? apply
            : showEmbeddedBanner
              ? () => {
                  void applyOtaUpdateIfAvailable().finally(() => {
                    setOta(otaUiFromContext(latestContext));
                    if (latestContext?.isUpdatePending) apply();
                  });
                }
              : undefined
        }
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: "#1d4ed8",
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          maxWidth: 420,
          width: "100%",
          opacity: pressed ? 0.9 : 1,
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        })}
      >
        <Feather
          name={ota.isUpdatePending ? "check-circle" : ota.isDownloading ? "refresh-cw" : "download"}
          size={18}
          color="#fff"
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 14 }}>
            {ota.isUpdatePending
              ? "Discover Home ready"
              : showEmbeddedBanner
                ? "Restore Discover Home"
                : ota.isDownloading
                  ? "Downloading update…"
                  : "App update ready"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.9)", fontFamily: FONT.medium, fontSize: 11 }}>
            {ota.isUpdatePending
              ? "Tap to restart — loads Table Tennis, Coach, and the new Home layout."
              : showEmbeddedBanner
                ? "You're on an older layout. Tap to download the latest UI."
                : "Keep the app open for a moment."}
          </Text>
        </View>
        <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 12 }}>
          {ota.isUpdatePending ? "Restart" : "Update"}
        </Text>
      </Pressable>
    </View>
  );
}
