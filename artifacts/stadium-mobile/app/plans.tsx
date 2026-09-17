import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import { SUBSCRIPTION_PLANS, type PlanId } from "@/lib/entitlements";

/**
 * Preview Plans screen — local entitlement selection only.
 * Real StoreKit / RevenueCat billing requires a native rebuild + runtimeVersion
 * bump and is intentionally out of scope for OTA-safe subscription foundation.
 */
export default function PlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { entitlement, selectPlan } = useSubscription();
  const [draft, setDraft] = React.useState<PlanId>(entitlement.planId);

  React.useEffect(() => {
    setDraft(entitlement.planId);
  }, [entitlement.planId]);

  const onContinue = () => {
    selectPlan(draft);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

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
            Preview entitlements only — nothing is charged. Coach, browse, and OTA
            keep working on every plan.
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
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: colors.card,
                borderRadius: colors.radius,
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                opacity: pressed ? 0.9 : 1,
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

        <Pressable
          onPress={onContinue}
          style={({ pressed }) => ({
            marginTop: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 15,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily: FONT.bold,
              fontSize: 15,
              color: colors.primaryForeground,
            }}
          >
            Continue
          </Text>
        </Pressable>

        <Text
          style={{
            fontFamily: FONT.medium,
            fontSize: 11,
            lineHeight: 16,
            color: colors.mutedForeground,
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Demo plans · no real billing · 21+ · Hypothetical analysis only
        </Text>
      </ScrollView>
    </View>
  );
}
