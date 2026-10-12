import Feather from "@expo/vector-icons/Feather";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import type { OtaSnapshot } from "@/lib/ota";

/**
 * Blue banner — controller snapshot only.
 * Visible iff state === "ready" && downloadedUpdateId != runningUpdateId.
 * Restart is the sole production path to reloadAsync.
 */
export function OtaUpdateBanner({
  snapshot,
  onRestart,
}: {
  snapshot: OtaSnapshot;
  onRestart: () => void;
}) {
  const insets = useSafeAreaInsets();

  if (!snapshot.bannerVisible) return null;

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
        onPress={onRestart}
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
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Feather name="download" size={16} color="#fff" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 13 }}>
            App update ready
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.85)",
              fontFamily: FONT.medium,
              fontSize: 11,
            }}
          >
            Tap Restart to load the new update.
          </Text>
        </View>
        <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 12 }}>
          Restart
        </Text>
      </Pressable>
    </View>
  );
}
