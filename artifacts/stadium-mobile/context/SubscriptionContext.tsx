import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, useUser } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SoftPaywallModal } from "@/components/SoftPaywallModal";
import {
  SUBSCRIPTION_STORAGE_KEY,
  type EntitlementView,
  type PlanId,
  type SoftProFeatureLabel,
  type SubscriptionPersistedState,
  applyStoreKitSnapshot,
  buildEntitlementView,
  ensureTrialStarted,
  normalizePromoCode,
  parseAdminEmails,
  redeemPromoCode,
  redeemPromoFailureMessage,
  sanitizeSubscriptionState,
  softRequirePro,
} from "@/lib/entitlements";
import {
  addCustomerInfoListener,
  configurePurchases,
  isStoreKitAvailable,
  purchasePlan,
  refreshCustomerSnapshot,
  restorePurchases,
  storeKitUnavailableReason,
  type StoreKitCustomerSnapshot,
} from "@/lib/purchases";
import { syncSubscriptionToServer } from "@/lib/subscriptionApi";

type RedeemResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type PurchaseActionResult =
  | { ok: true; message: string }
  | { ok: false; cancelled?: boolean; message: string };

type SubscriptionContextValue = {
  hydrated: boolean;
  entitlement: EntitlementView;
  /** True when this native build can open Apple StoreKit billing. */
  storeKitReady: boolean;
  /** Why StoreKit is unavailable (null when ready). */
  storeKitBlockedReason: string | null;
  /** Busy while a purchase or restore is in flight. */
  billingBusy: boolean;
  /**
   * Select free trial locally, or purchase Go/Pro via Apple StoreKit when
   * available. Falls back to a local entitlement only when StoreKit is offline
   * (dev / missing key) so QA can still exercise gates.
   */
  selectPlan: (planId: PlanId) => Promise<PurchaseActionResult>;
  /** Restore App Store purchases (also listed under Settings → Subscriptions). */
  restorePurchasesAction: () => Promise<PurchaseActionResult>;
  /** Soft gate: true if allowed; false opens dismissible paywall. */
  requirePro: (featureLabel?: SoftProFeatureLabel) => boolean;
  openSoftPaywall: (featureLabel?: SoftProFeatureLabel) => void;
  closeSoftPaywall: () => void;
  /** Redeem a local promo code (or from ?promo= link). */
  redeemPromo: (code: string) => RedeemResult;
};

const DEFAULT_STATE: SubscriptionPersistedState = {
  planId: "free",
  trialStartedAtMs: null,
  redeemedPromoCode: null,
  promoExpiresAtMs: null,
  promoLifetime: false,
  promoRedeemCounts: {},
  storeKitActive: false,
  storeKitProductId: null,
  storeKitManagementUrl: null,
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

function nowMs() {
  return Date.now();
}

function readAdminEmails(): string[] {
  return parseAdminEmails(process.env.EXPO_PUBLIC_ADMIN_EMAILS);
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const [state, setState] = useState<SubscriptionPersistedState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [gatedFeature, setGatedFeature] = useState("");
  const [tick, setTick] = useState(0);
  const [billingBusy, setBillingBusy] = useState(false);
  const [storeKitReady, setStoreKitReady] = useState(false);
  const loaded = useRef(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null;
  const adminEmails = useMemo(() => readAdminEmails(), []);
  // Do not probe Purchases during first render — NativeModules read is sync/safe;
  // memoize so we never accidentally re-enter require paths.
  const storeKitBlockedReason = useMemo(() => storeKitUnavailableReason(), []);

  const applySnapshot = useCallback((snapshot: StoreKitCustomerSnapshot) => {
    setState((prev) => applyStoreKitSnapshot(prev, snapshot));
    void syncSubscriptionToServer(snapshot);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
        const parsed = raw ? sanitizeSubscriptionState(JSON.parse(raw)) : DEFAULT_STATE;
        const withTrial = ensureTrialStarted(parsed, nowMs());
        if (!cancelled) setState(withTrial);
      } catch {
        if (!cancelled) {
          setState(ensureTrialStarted(DEFAULT_STATE, nowMs()));
        }
      } finally {
        loaded.current = true;
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  // Configure RevenueCat / StoreKit once hydrated; re-login when Clerk user changes.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      const ready = await configurePurchases(isSignedIn ? userId : null);
      if (cancelled) return;
      setStoreKitReady(ready && isStoreKitAvailable());
      if (!ready) return;
      const snapshot = await refreshCustomerSnapshot();
      if (!cancelled && snapshot) applySnapshot(snapshot);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, isSignedIn, userId, applySnapshot]);

  useEffect(() => {
    if (!hydrated || !storeKitReady) return;
    return addCustomerInfoListener((snapshot) => {
      applySnapshot(snapshot);
    });
  }, [hydrated, storeKitReady, applySnapshot]);

  // Refresh trial/promo countdown roughly once an hour while mounted.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const entitlement = useMemo(
    () =>
      buildEntitlementView(state, nowMs(), {
        email: isSignedIn ? email : null,
        adminEmails,
      }),
    // tick forces recompute after long sessions
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, tick, isSignedIn, email, adminEmails],
  );

  const selectPlan = useCallback(
    async (planId: PlanId): Promise<PurchaseActionResult> => {
      if (planId === "free") {
        if (storeKitReady) {
          const snapshot = await refreshCustomerSnapshot();
          if (snapshot?.planId) {
            applySnapshot(snapshot);
            return {
              ok: true,
              message:
                "You still have an active Apple subscription. Manage it in Settings → Subscriptions.",
            };
          }
        }
        setState((prev) => ({
          ...prev,
          planId: "free",
          storeKitActive: false,
          storeKitProductId: null,
        }));
        return { ok: true, message: "Free trial selected." };
      }

      if (!storeKitReady) {
        // Dev / Expo Go fallback — local unlock only (not in Apple Subscriptions list).
        setState((prev) => ({
          ...prev,
          planId,
          storeKitActive: false,
          storeKitProductId: null,
        }));
        return {
          ok: true,
          message:
            storeKitBlockedReason ??
            "Local preview unlock (Apple billing needs a StoreKit-enabled iOS build).",
        };
      }

      setBillingBusy(true);
      try {
        const result = await purchasePlan(planId);
        if (!result.ok) {
          return {
            ok: false,
            cancelled: result.cancelled,
            message: result.message,
          };
        }
        applySnapshot(result.snapshot);
        const name = planId === "pro" ? "Stadium Edge Pro" : "Stadium Edge Go";
        return {
          ok: true,
          message: `${name} is active via Apple. It appears under Settings → Subscriptions.`,
        };
      } finally {
        setBillingBusy(false);
      }
    },
    [storeKitReady, storeKitBlockedReason, applySnapshot],
  );

  const restorePurchasesAction = useCallback(async (): Promise<PurchaseActionResult> => {
    if (!storeKitReady) {
      return {
        ok: false,
        message:
          storeKitBlockedReason ??
          "Restore requires an iOS build with Apple StoreKit enabled.",
      };
    }
    setBillingBusy(true);
    try {
      const result = await restorePurchases();
      if (!result.ok) return { ok: false, message: result.message };
      applySnapshot(result.snapshot);
      if (!result.restored) {
        return { ok: true, message: "No active Apple subscriptions found for this Apple ID." };
      }
      return {
        ok: true,
        message: "Purchases restored. Manage renewals in Settings → Subscriptions.",
      };
    } finally {
      setBillingBusy(false);
    }
  }, [storeKitReady, storeKitBlockedReason, applySnapshot]);

  const redeemPromo = useCallback((code: string): RedeemResult => {
    const normalized = normalizePromoCode(code);
    if (!normalized) {
      return { ok: false, message: "Enter a promo code." };
    }
    const result = redeemPromoCode(state, normalized, nowMs());
    if (!result.ok) {
      return { ok: false, message: redeemPromoFailureMessage(result.reason) };
    }
    setState(result.state);
    return {
      ok: true,
      message: result.definition.label,
    };
  }, [state]);

  const openSoftPaywall = useCallback((featureLabel: SoftProFeatureLabel = "Upgrade") => {
    setGatedFeature(String(featureLabel));
    setPaywallOpen(true);
  }, []);

  const closeSoftPaywall = useCallback(() => {
    setPaywallOpen(false);
    setGatedFeature("");
  }, []);

  const requirePro = useCallback(
    (featureLabel: SoftProFeatureLabel = "Upgrade") => {
      if (softRequirePro(entitlement.isPro)) return true;
      openSoftPaywall(featureLabel);
      return false;
    },
    [entitlement.isPro, openSoftPaywall],
  );

  const onSeePlans = useCallback(() => {
    closeSoftPaywall();
    router.push("/plans" as never);
  }, [closeSoftPaywall, router]);

  const onContinueTrial = useCallback(() => {
    setState((prev) => ensureTrialStarted(prev, nowMs()));
    closeSoftPaywall();
  }, [closeSoftPaywall]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      hydrated,
      entitlement,
      storeKitReady,
      storeKitBlockedReason,
      billingBusy,
      selectPlan,
      restorePurchasesAction,
      requirePro,
      openSoftPaywall,
      closeSoftPaywall,
      redeemPromo,
    }),
    [
      hydrated,
      entitlement,
      storeKitReady,
      storeKitBlockedReason,
      billingBusy,
      selectPlan,
      restorePurchasesAction,
      requirePro,
      openSoftPaywall,
      closeSoftPaywall,
      redeemPromo,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
      <SoftPaywallModal
        visible={paywallOpen}
        featureLabel={gatedFeature}
        onClose={closeSoftPaywall}
        onSeePlans={onSeePlans}
        onContinueTrial={entitlement.trialActive ? onContinueTrial : undefined}
        trialAvailable={entitlement.trialActive}
      />
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error("useSubscription must be used within SubscriptionProvider");
  }
  return ctx;
}

/**
 * Safe for screens that may render before the provider during tests / story
 * harnesses — returns null instead of throwing.
 */
export function useSubscriptionOptional(): SubscriptionContextValue | null {
  return useContext(SubscriptionContext);
}
