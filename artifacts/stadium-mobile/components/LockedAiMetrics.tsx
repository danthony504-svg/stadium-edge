import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useSubscriptionOptional } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";

/**
 * Soft-lock AI Grade / Confidence / Edge on pick cards for free users.
 * Pick text, odds, and Add to slip stay visible (Coach remains usable).
 */
export function useAiMetricsLocked(): boolean {
  const sub = useSubscriptionOptional();
  if (!sub?.hydrated) return false;
  return !sub.entitlement.isPro;
}

export function LockedAiMetricsTeaser({ dense }: { dense?: boolean }) {
  const colors = useColors();
  const sub = useSubscriptionOptional();

  const cell = (label: string) => (
    <View
      key={label}
      style={{
        flex: 1,
        minWidth: dense ? 88 : 96,
        paddingVertical: dense ? 10 : 12,
        paddingHorizontal: 11,
        borderRadius: 14,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: 0.92,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Feather name="lock" size={12} color={colors.mutedForeground} />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 9.5,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          marginTop: 6,
          color: colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 18,
        }}
      >
        •••
      </Text>
      <Text
        style={{
          marginTop: 4,
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 11,
        }}
      >
        Pro unlock
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={() => sub?.openSoftPaywall("AI Grade & Edge")}
      accessibilityRole="button"
      accessibilityLabel="Unlock AI Grade, Confidence, and Edge"
      style={{ gap: 8 }}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        {cell("AI Grade")}
        {cell("Confidence")}
        {cell("Edge")}
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 12,
          lineHeight: 17,
        }}
      >
        Pick stays free — unlock AI Grade, Confidence, and Edge with Go, Pro, a promo, or
        admin.
      </Text>
    </Pressable>
  );
}
