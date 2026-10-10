import Feather from "@expo/vector-icons/Feather";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useSubscriptionOptional } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import { COACH_PREMIUM_FEATURE_LABEL } from "@/lib/coachPremiumGate";

/**
 * Soft-lock AI Grade / Confidence / Edge (and related premium pick fields)
 * for non-subscribers. Unlock requires signed-in + verified StoreKit Go/Pro
 * (or admin) — never APP_REVIEW_MODE or a local boolean alone.
 */
export function useAiMetricsLocked(): boolean {
  const sub = useSubscriptionOptional();
  if (!sub?.hydrated) return true;
  return !sub.coachPremiumUnlocked;
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
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
        Locked
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={() => sub?.openSoftPaywall(COACH_PREMIUM_FEATURE_LABEL)}
      accessibilityRole="button"
      accessibilityLabel="Unlock AI Picks"
      accessibilityHint="Opens subscription plans for Stadium Edge Go or Pro"
      style={{ gap: 8 }}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        {cell("AI Grade")}
        {cell("Confidence")}
        {cell("Edge")}
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: dense ? 10 : 12,
          borderRadius: 12,
          backgroundColor: colors.primary,
        }}
      >
        <Feather name="unlock" size={14} color={colors.primaryForeground} />
        <Text
          style={{
            color: colors.primaryForeground,
            fontFamily: FONT.bold,
            fontSize: 13,
          }}
        >
          Unlock AI Picks
        </Text>
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 12,
          lineHeight: 17,
        }}
      >
        Matchups stay visible — subscribe with Stadium Edge Go or Pro to see the
        recommended pick, lines, odds, grades, and AI breakdown.
      </Text>
    </Pressable>
  );
}
