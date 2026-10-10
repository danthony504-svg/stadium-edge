import Feather from "@expo/vector-icons/Feather";
import { useAuth } from "@clerk/expo";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useSubscriptionOptional } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import { COACH_PREMIUM_FEATURE_LABEL } from "@/lib/coachPremiumGate";

/**
 * Soft-lock for Coach identity / detailed breakdowns.
 * Grade / Confidence / Edge stay visible on cards when data is present;
 * this teaser is the CTA + locked-breakdown placeholder.
 */
export function useAiMetricsLocked(): boolean {
  const sub = useSubscriptionOptional();
  if (!sub?.hydrated) return true;
  return !sub.coachPremiumUnlocked;
}

/** CTA to reveal blurred identity / lines (not used to hide grades). */
export function LockedAiMetricsTeaser({ dense }: { dense?: boolean }) {
  const colors = useColors();
  const sub = useSubscriptionOptional();
  const { isSignedIn } = useAuth();
  const label = COACH_PREMIUM_FEATURE_LABEL;
  const cta = isSignedIn ? "Subscribe to Reveal Picks" : "Sign In / Subscribe to Reveal Picks";

  return (
    <Pressable
      onPress={() => sub?.openSoftPaywall(label)}
      accessibilityRole="button"
      accessibilityLabel={cta}
      accessibilityHint="Opens sign in or subscription plans to reveal picks"
      style={{ gap: 8 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: dense ? 10 : 12,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Feather name="lock" size={14} color={colors.mutedForeground} />
        <Text
          style={{
            flex: 1,
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 12,
            lineHeight: 17,
          }}
        >
          Teams, players, lines, and odds are hidden. AI Grade, Confidence, and
          Edge stay visible above.
        </Text>
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
          {cta}
        </Text>
      </View>
    </Pressable>
  );
}
