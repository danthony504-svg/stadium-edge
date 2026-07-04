import * as Updates from "expo-updates";
import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";

/** Prompts the user when a prefetched OTA is ready — one tap applies it. */
export function OtaUpdateBanner() {
  const insets = useSafeAreaInsets();
  const { isUpdatePending, isDownloading } = Updates.useUpdates();

  if (__DEV__ || !Updates.isEnabled) return null;
  if (!isUpdatePending && !isDownloading) return null;

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
        onPress={isUpdatePending ? apply : undefined}
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
          opacity: pressed && isUpdatePending ? 0.9 : 1,
        })}
      >
        <Feather name={isUpdatePending ? "download" : "refresh-cw"} size={16} color="#fff" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 13 }}>
            {isUpdatePending ? "App update ready" : "Downloading update…"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontFamily: FONT.medium, fontSize: 11 }}>
            {isUpdatePending
              ? "Tap to restart and load the latest Discover + Coach fixes."
              : "Keep the app open for a moment."}
          </Text>
        </View>
        {isUpdatePending ? (
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 12 }}>Restart</Text>
        ) : null}
      </Pressable>
    </View>
  );
}
