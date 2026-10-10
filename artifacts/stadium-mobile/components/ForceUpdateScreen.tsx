import { Image } from "expo-image";
import * as Linking from "expo-linking";
import React, { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import type { ForceUpdateDecision } from "@/lib/appVersion";

const LOGO = require("@/assets/images/logo.png");

/**
 * Full-screen App Store update gate. Blocks navigation underneath.
 * Does not install updates via Expo OTA — opens the official listing only.
 */
export function ForceUpdateScreen({ decision }: { decision: ForceUpdateDecision }) {
  const insets = useSafeAreaInsets();
  const openStore = useCallback(() => {
    void Linking.openURL(decision.appStoreUrl);
  }, [decision.appStoreUrl]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0f172a",
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 28,
        justifyContent: "center",
        gap: 20,
      }}
      accessibilityViewIsModal
    >
      <View style={{ alignItems: "center", gap: 16 }}>
        <Image
          source={LOGO}
          style={{ width: 96, height: 96, borderRadius: 22 }}
          contentFit="contain"
          accessibilityLabel="Stadium Edge"
        />
        <Text
          style={{
            fontFamily: FONT.display,
            fontSize: 28,
            color: "#f8fafc",
            textAlign: "center",
          }}
        >
          Stadium Edge
        </Text>
        <Text
          style={{
            fontFamily: FONT.bold,
            fontSize: 20,
            color: "#38bdf8",
            textAlign: "center",
          }}
        >
          Update Required
        </Text>
        <Text
          style={{
            fontFamily: FONT.body,
            fontSize: 15,
            lineHeight: 22,
            color: "#cbd5e1",
            textAlign: "center",
          }}
        >
          {decision.message}
        </Text>
        <Text
          style={{
            fontFamily: FONT.medium,
            fontSize: 12,
            color: "#64748b",
            textAlign: "center",
          }}
        >
          Installed {decision.currentVersion} · Requires {decision.minIosVersion}
        </Text>
      </View>

      <Pressable
        onPress={openStore}
        accessibilityRole="button"
        accessibilityLabel="Update on the App Store"
        style={({ pressed }) => ({
          marginTop: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#38bdf8",
          borderRadius: 14,
          paddingVertical: 16,
          opacity: pressed ? 0.88 : 1,
        })}
      >
        <Text
          style={{
            fontFamily: FONT.bold,
            fontSize: 16,
            color: "#0f172a",
          }}
        >
          Update on the App Store
        </Text>
      </Pressable>
    </View>
  );
}
