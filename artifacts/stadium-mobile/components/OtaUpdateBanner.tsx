import Feather from "@expo/vector-icons/Feather";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import type { OtaSnapshot } from "@/lib/ota";
import { OTA_EMBEDDED_TARGET_ID } from "@/lib/ota";

function shortId(id: string | null): string {
  if (!id) return "—";
  const s = String(id).trim();
  if (s === OTA_EMBEDDED_TARGET_ID) return "embedded";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…`;
}

/**
 * Blue banner — controller snapshot only.
 * Visible iff state === "ready" && downloadedUpdateId != runningUpdateId
 * (or rollback-to-embedded while still on a tip).
 * Restart is the sole production path to reloadAsync.
 * Shows running + downloaded ids so older menus without Device attestation
 * can still report identity while an update is staged.
 *
 * Identify the pending target accurately (tip UUID or embedded rollback).
 * Do not use feature-marketing phrasing for apply/rollback banners.
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

  const title = snapshot.isRollBackToEmbedded
    ? "Recovery update ready"
    : "App update ready";
  const subtitle = snapshot.isRollBackToEmbedded
    ? `Tap Restart · return to embedded (leaving ${shortId(snapshot.runningUpdateId)})`
    : `Tap Restart · running ${shortId(snapshot.runningUpdateId)} → ${shortId(snapshot.downloadedUpdateId)}`;

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
            {title}
          </Text>
          <Text
            selectable
            style={{
              color: "rgba(255,255,255,0.85)",
              fontFamily: FONT.medium,
              fontSize: 11,
            }}
          >
            {subtitle}
          </Text>
        </View>
        <Text style={{ color: "#fff", fontFamily: FONT.bold, fontSize: 12 }}>
          Restart
        </Text>
      </Pressable>
    </View>
  );
}
