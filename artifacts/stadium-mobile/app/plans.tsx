import { useAuth } from "@clerk/expo";
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
import { useSubscription } from "@/context/SubscriptionContext";
import { useColors } from "@/hooks/useColors";
import { PAID_SUBSCRIPTION_PLANS, type PlanId } from "@/lib/entitlements";
import {
  draftPlanFromReturnParams,
  isPaidPlanId,
  signInHrefForSubscriptionIntent,
  type PaidPlanId,
  type SubscriptionIntent,
} from "@/lib/pendingSubscriptionIntent";
import {
  clearPendingSubscriptionIntent,
  loadPendingSubscriptionIntent,
  savePendingSubscriptionIntent,
} from "@/lib/pendingSubscriptionIntentStorage";
import { isBillingAuthBlocked } from "@/lib/purchaseAuthGate";
import {
  fetchStoreKitCatalog,
  type StoreKitCatalog,
  type StoreKitCatalogProduct,
} from "@/lib/purchases";

const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

function planNote(
  planId: PlanId,
  catalog: StoreKitCatalog | null,
  fallbackNote: string,
): string {
  const row: StoreKitCatalogProduct | null | undefined =
    planId === "go" ? catalog?.go : planId === "pro" ? catalog?.pro : null;
  if (!row) return fallbackNote;
  const price = row.priceString
    ? planId === "go"
      ? `${row.priceString}/week`
      : `${row.priceString}/month`
    : planId === "go"
      ? "$9.99/week"
      : "$29.99/month";
  // Only promise a trial when StoreKit reports a free introductory offer.
  if (row.hasFreeTrial) {
    const days = row.freeTrialDays ?? 7;
    return `${days}-day free trial, then ${price}`;
  }
  return `Billed through Apple · ${price}`;
}

/**
 * Plans screen — Go/Pro via Apple StoreKit (auto-renewable).
 * Logged-out users may browse prices; Subscribe / Restore require Clerk sign-in.
 * Never auto-starts StoreKit after returning from auth — user must tap again.
 */
export default function PlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string; intent?: string }>();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const {
    entitlement,
    selectPlan,
    restorePurchasesAction,
    storeKitReady,
    storeKitBlockedReason,
    storeKitManagementUrl,
    billingBusy,
  } = useSubscription();
  const defaultPaid: PaidPlanId =
    entitlement.planId === "pro" || entitlement.planId === "go" ? entitlement.planId : "go";
  const [draft, setDraft] = React.useState<PaidPlanId>(defaultPaid);
  const [catalog, setCatalog] = React.useState<StoreKitCatalog | null>(null);
  const authBlocked = isBillingAuthBlocked({
    authLoaded: !!authLoaded,
    isSignedIn: !!isSignedIn,
    userId,
  });
  const ctaDisabled = billingBusy || !authLoaded;

  // Apply return-from-sign-in selection (URL + storage). Never auto-purchase.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadPendingSubscriptionIntent();
      if (cancelled) return;
      const next = draftPlanFromReturnParams({
        plan: typeof params.plan === "string" ? params.plan : null,
        intent: typeof params.intent === "string" ? params.intent : null,
        stored,
        fallback: defaultPaid,
      });
      setDraft(next);
      // Clear pending intent after applying UI selection so a later visit
      // does not surprise-select — and never triggers StoreKit.
      if (stored) await clearPendingSubscriptionIntent();
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount / param change — not when entitlement flips mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.plan, params.intent]);

  React.useEffect(() => {
    if (entitlement.planId === "go" || entitlement.planId === "pro") {
      setDraft(entitlement.planId);
    }
  }, [entitlement.planId]);

  React.useEffect(() => {
    let cancelled = false;
    if (!storeKitReady) {
      setCatalog(null);
      return;
    }
    (async () => {
      const next = await fetchStoreKitCatalog();
      if (!cancelled) setCatalog(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [storeKitReady]);

  const beginSignInForIntent = async (intent: SubscriptionIntent) => {
    await savePendingSubscriptionIntent(intent);
    router.push(signInHrefForSubscriptionIntent(intent) as never);
  };

  const onContinue = async () => {
    const planId: PaidPlanId = draft === "pro" ? "pro" : "go";
    if (!authLoaded) return;
    if (!isSignedIn || !userId) {
      await beginSignInForIntent({ intent: "purchase", planId });
      return;
    }
    const result = await selectPlan(planId);
    if (!result.ok) {
      if (result.cancelled) return;
      if (result.needsSignIn) {
        await beginSignInForIntent({ intent: "purchase", planId });
        return;
      }
      Alert.alert("Couldn’t continue", result.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const onRestore = async () => {
    if (!authLoaded) return;
    if (!isSignedIn || !userId) {
      await beginSignInForIntent({
        intent: "restore",
        planId: isPaidPlanId(draft) ? draft : undefined,
      });
      return;
    }
    const result = await restorePurchasesAction();
    if (!result.ok) {
      if (result.needsSignIn) {
        await beginSignInForIntent({ intent: "restore", planId: draft });
        return;
      }
      Alert.alert("Restore failed", result.message);
      return;
    }
    Alert.alert("Restore", result.message);
  };

  const onManage = () => {
    const url =
      (storeKitManagementUrl && storeKitManagementUrl.trim()) || APPLE_SUBSCRIPTIONS_URL;
    Linking.openURL(url).catch(() => {
      Alert.alert(
        "Subscriptions",
        "Open Settings → [your name] → Subscriptions on this iPhone to manage Stadium Edge.",
      );
    });
  };

  const selectedPlan = PAID_SUBSCRIPTION_PLANS.find((p) => p.id === draft);
  const continueLabel = authBlocked
    ? `Sign in to subscribe · ${selectedPlan?.priceLabel ?? ""}`
    : `Subscribe · ${selectedPlan?.priceLabel ?? ""}`;
  const anyFreeTrial = !!(catalog?.go?.hasFreeTrial || catalog?.pro?.hasFreeTrial);

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
            {anyFreeTrial
              ? "Eligible App Store accounts may include a free trial when Apple shows an introductory offer. Discover + Coach + Props + Slip stay free; Edge Lock, Steals, Simulator, and Model Report need a plan. Billed through Apple — manage under Settings → Subscriptions."
              : "Discover + Coach + Props + Slip stay free; Edge Lock, Steals, Simulator, and Model Report need a plan. Billed through Apple — manage under Settings → Subscriptions."}
          </Text>
        </View>

        {PAID_SUBSCRIPTION_PLANS.map((plan) => {
          const selected = draft === plan.id;
          const note = planNote(plan.id, catalog, plan.note);
          const priceLabel =
            plan.id === "go"
              ? catalog?.go?.priceString
                ? `${catalog.go.priceString}/week`
                : plan.priceLabel
              : catalog?.pro?.priceString
                ? `${catalog.pro.priceString}/month`
                : plan.priceLabel;
          return (
            <Pressable
              key={plan.id}
              onPress={() => setDraft(plan.id as PaidPlanId)}
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
                  {priceLabel}
                </Text>
                {note ? (
                  <Text
                    style={{
                      fontFamily: FONT.body,
                      fontSize: 12,
                      lineHeight: 17,
                      color: colors.mutedForeground,
                      marginTop: 2,
                    }}
                  >
                    {note}
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
          disabled={ctaDisabled}
          style={({ pressed }) => ({
            marginTop: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 15,
            opacity: pressed || ctaDisabled ? 0.85 : 1,
            minHeight: 52,
          })}
        >
          {billingBusy || !authLoaded ? (
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
            disabled={ctaDisabled}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              opacity: pressed || ctaDisabled ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: FONT.semibold,
                fontSize: 13,
                color: colors.foreground,
              }}
            >
              {authBlocked ? "Sign in to restore" : "Restore purchases"}
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
            ? "Billed by Apple · Cancel anytime in Settings → Subscriptions · Sign in required to subscribe · 21+ · Hypothetical analysis only"
            : `${storeKitBlockedReason ?? "Apple billing unlocks after a StoreKit-enabled iOS rebuild."} · 21+ · Hypothetical analysis only`}
        </Text>
      </ScrollView>
    </View>
  );
}
