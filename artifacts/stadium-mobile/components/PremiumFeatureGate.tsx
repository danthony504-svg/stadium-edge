import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import {
  PREMIUM_FEATURES,
  type PremiumFeatureId,
  canAccessPremiumFeature,
} from "@/lib/entitlements";

type PremiumFeatureGateProps = {
  featureId: PremiumFeatureId;
  children: React.ReactNode;
};

/**
 * Soft gate for secondary premium tabs. Core browse/Coach never use this.
 * When locked, shows an upgrade CTA instead of the tool — dismissible via Plans.
 */
export function PremiumFeatureGate({ featureId, children }: PremiumFeatureGateProps) {
  const colors = useColors();
  const router = useRouter();
  const { entitlement, openSoftPaywall, hydrated } = useSubscription();
  const meta = PREMIUM_FEATURES[featureId];
  const allowed = canAccessPremiumFeature(featureId, entitlement.isPro);

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (allowed) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingHorizontal: 24,
        justifyContent: "center",
        gap: 16,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignSelf: "center",
        }}
      >
        <Feather name="lock" size={24} color={colors.primary} />
      </View>
      <Text
        style={{
          fontFamily: FONT.display,
          fontSize: 22,
          color: colors.foreground,
          textAlign: "center",
        }}
      >
        {meta.label}
      </Text>
      <Text
        style={{
          fontFamily: FONT.body,
          fontSize: 14,
          lineHeight: 21,
          color: colors.mutedForeground,
          textAlign: "center",
        }}
      >
        Included with Go ($9.99/wk), Pro ($29.99/mo), your free trial, an admin account, or a
        promo code. Discover, Coach, Props, and Slip stay free.
      </Text>
      <Pressable
        onPress={() => openSoftPaywall(meta.label)}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.primary,
          borderRadius: 12,
          paddingVertical: 14,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.primaryForeground }}>
          Unlock {meta.label}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => router.push("/plans" as never)}
        style={({ pressed }) => ({
          alignItems: "center",
          paddingVertical: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.mutedForeground }}>
          See plans or enter a promo code
        </Text>
      </Pressable>
    </View>
  );
}
