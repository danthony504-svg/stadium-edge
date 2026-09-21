import Feather from "@expo/vector-icons/Feather";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { PromoCodeForm } from "@/components/PromoCodeForm";
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import {
  SUBSCRIPTION_PLANS,
  extractPromoFromQuery,
  type PlanId,
} from "@/lib/entitlements";

/**
 * Plans screen — Free trial locally; Go/Pro purchase via Apple StoreKit
 * (RevenueCat) so the subscription appears under iOS Settings → Subscriptions.
 * Native rebuild + runtimeVersion bump required for real billing.
 */
export default function PlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ promo?: string | string[]; code?: string | string[] }>();
  const promoFromLink = extractPromoFromQuery(params);
  const {
    entitlement,
    selectPlan,
    restorePurchasesAction,
    storeKitReady,
    storeKitBlockedReason,
    billingBusy,
  } = useSubscription();
  const [draft, setDraft] = React.useState<PlanId>(entitlement.planId);

  React.useEffect(() => {
    setDraft(entitlement.planId);
  }, [entitlement.planId]);

  const onContinue = async () => {
    const result = await selectPlan(draft);
    if (!result.ok) {
      if (result.cancelled) return;
      Alert.alert("Couldn’t continue", result.message);
      return;
    }
    if (draft !== "free" && !storeKitReady) {
      Alert.alert("Preview unlock", result.message);
    }
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const onRestore = async () => {
    const result = await restorePurchasesAction();
    if (!result.ok) {
      Alert.alert("Restore failed", result.message);
      return;
    }
    Alert.alert("Restore", result.message);
  };

  const onManage = () => {
    const url =
      entitlement.unlockSource === "storekit"
        ? "https://apps.apple.com/account/subscriptions"
        : "https://apps.apple.com/account/subscriptions";
    Linking.openURL(url).catch(() => {
      Alert.alert(
        "Subscriptions",
        "Open Settings → [your name] → Subscriptions on this iPhone to manage Stadium Edge.",
      );
    });
  };

  const continueLabel =
    draft === "free"
      ? "Continue with free trial"
      : storeKitReady
        ? `Subscribe · ${SUBSCRIPTION_PLANS.find((p) => p.id === draft)?.priceLabel ?? ""}`
        : "Continue (preview)";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontFamily: FONT.display, fontSize: 24, color: colors.foreground }}>
          Plans
        </Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityLabel="Close"
          style={{
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
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 28,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: 10, marginBottom: 8, marginTop: 4 }}>
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
            }}
          >
            <Feather name="zap" size={26} color={colors.primary} />
          </View>
          <Text
            style={{
              fontFamily: FONT.semibold,
              fontSize: 16,
              color: colors.foreground,
              textAlign: "center",
            }}
          >
            Available plans
          </Text>
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 13,
              lineHeight: 19,
              color: colors.mutedForeground,
              textAlign: "center",
            }}
          >
            Free trial unlocks everything for 7 days. After that, Discover + Coach + Props +
            Slip stay free; Edge Lock, Steals, Simulator, and Model Report need a plan, admin,
            or promo. Paid plans bill through Apple and show under Settings → Subscriptions.
          </Text>
        </View>

        {SUBSCRIPTION_PLANS.map((plan) => {
          const selected = draft === plan.id;
          return (
            <Pressable
              key={plan.id}
              onPress={() => setDraft(plan.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              disabled={billingBusy}
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: colors.card,
                borderRadius: colors.radius,
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                opacity: pressed || billingBusy ? 0.9 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{
                    fontFamily: FONT.semibold,
                    fontSize: 16,
                    color: colors.foreground,
                  }}
                >
                  {plan.name}
                </Text>
                <Text
                  style={{
                    fontFamily: FONT.medium,
                    fontSize: 14,
                    color: colors.mutedForeground,
                  }}
                >
                  {plan.priceLabel} {plan.periodLabel}
                </Text>
                {plan.note ? (
                  <Text
                    style={{
                      fontFamily: FONT.body,
                      fontSize: 12,
                      lineHeight: 17,
                      color: colors.mutedForeground,
                      marginTop: 2,
                    }}
                  >
                    {plan.note}
                  </Text>
                ) : null}
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? colors.primary : "transparent",
                  borderWidth: selected ? 0 : 2,
                  borderColor: colors.border,
                }}
              >
                {selected ? (
                  <Feather name="check" size={14} color={colors.primaryForeground} />
                ) : null}
              </View>
            </Pressable>
          );
        })}

        <PromoCodeForm initialCode={promoFromLink} autoRedeem={!!promoFromLink} />

        <Pressable
          onPress={onContinue}
          disabled={billingBusy}
          style={({ pressed }) => ({
            marginTop: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 15,
            opacity: pressed || billingBusy ? 0.85 : 1,
            minHeight: 52,
          })}
        >
          {billingBusy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text
              style={{
                fontFamily: FONT.bold,
                fontSize: 15,
                color: colors.primaryForeground,
              }}
            >
              {continueLabel}
            </Text>
          )}
        </Pressable>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
          <Pressable
            onPress={onRestore}
            disabled={billingBusy}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              opacity: pressed || billingBusy ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: FONT.semibold,
                fontSize: 13,
                color: colors.foreground,
              }}
            >
              Restore purchases
            </Text>
          </Pressable>
          <Pressable
            onPress={onManage}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: FONT.semibold,
                fontSize: 13,
                color: colors.foreground,
              }}
            >
              Manage in Apple
            </Text>
          </Pressable>
        </View>

        <Text
          style={{
            fontFamily: FONT.medium,
            fontSize: 11,
            lineHeight: 16,
            color: colors.mutedForeground,
            textAlign: "center",
            letterSpacing: 0.3,
          }}
        >
          {storeKitReady
            ? "Billed by Apple · Cancel anytime in Settings → Subscriptions · 21+ · Hypothetical analysis only"
            : `${storeKitBlockedReason ?? "Apple billing unlocks after a StoreKit-enabled iOS rebuild."} · 21+ · Hypothetical analysis only`}
        </Text>
      </ScrollView>
    </View>
  );
}
