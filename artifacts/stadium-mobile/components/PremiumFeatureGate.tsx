import { useAuth } from "@clerk/expo";
import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import {
  PREMIUM_FEATURES,
  type PremiumFeatureId,
  canAccessPremiumFeature,
} from "@/lib/entitlements";
import { closeStackOrHome } from "@/lib/stackCloseNav";

type PremiumFeatureGateProps = {
  featureId: PremiumFeatureId;
  children: React.ReactNode;
};

/**
 * Soft gate for secondary premium tabs. Discover / Coach / Plans / Account never use this.
 * Logged out → Sign In. Logged in without sub → Subscribe.
 * Open only for verified Go/Pro, admin, or designated App Review account email.
 *
 * Locked UI always exposes the same top-right Close control as Account/Plans so
 * Free users are never trapped (e.g. Notifications stack card with no hamburger).
 */
export function PremiumFeatureGate({ featureId, children }: PremiumFeatureGateProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { entitlement, openSoftPaywall, hydrated } = useSubscription();
  const meta = PREMIUM_FEATURES[featureId];
  const allowed = canAccessPremiumFeature(featureId, entitlement.isPro);

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (allowed) return <>{children}</>;

  const needsSignIn = !isSignedIn;
  const primaryLabel = needsSignIn ? "Sign In" : `Subscribe to unlock ${meta.label}`;
  const body = needsSignIn
    ? `Sign in, then subscribe to Stadium Edge Go ($9.99/wk) or Pro ($29.99/mo) via Apple to use ${meta.label}. Discover, Coach, Plans, and Account stay free.`
    : `Included with Go ($9.99/wk) or Pro ($29.99/mo) via Apple. Discover, Coach, Plans, and Account stay free — Coach pick details unlock with a verified subscription.`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Pressable
        onPress={() => closeStackOrHome(router)}
        hitSlop={12}
        accessibilityLabel="Close"
        accessibilityRole="button"
        style={{
          position: "absolute",
          top: insets.top + 16,
          right: 20,
          zIndex: 50,
          width: 38,
          height: 38,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Feather name="x" size={20} color={colors.foreground} />
      </Pressable>
      <View
        style={{
          flex: 1,
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
          {body}
        </Text>
        <Pressable
          onPress={() => {
            if (needsSignIn) {
              router.push("/sign-in" as never);
              return;
            }
            openSoftPaywall(meta.label);
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 14,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.primaryForeground }}>
            {primaryLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => router.push((needsSignIn ? "/sign-in" : "/plans") as never)}
          style={({ pressed }) => ({
            alignItems: "center",
            paddingVertical: 10,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.mutedForeground }}>
            {needsSignIn ? "Create an account" : "See plans"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
