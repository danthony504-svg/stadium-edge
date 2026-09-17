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
  buildEntitlementView,
  ensureTrialStarted,
  normalizePromoCode,
  parseAdminEmails,
  redeemPromoCode,
  sanitizeSubscriptionState,
  softRequirePro,
} from "@/lib/entitlements";

type RedeemResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type SubscriptionContextValue = {
  hydrated: boolean;
  entitlement: EntitlementView;
  /** Local preview plan selection — no StoreKit charge. */
  selectPlan: (planId: PlanId) => void;
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
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const [state, setState] = useState<SubscriptionPersistedState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [gatedFeature, setGatedFeature] = useState("");
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null;
  const adminEmails = useMemo(() => readAdminEmails(), []);

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

  const selectPlan = useCallback((planId: PlanId) => {
    setState((prev) => ({ ...prev, planId }));
  }, []);

  const redeemPromo = useCallback((code: string): RedeemResult => {
    const normalized = normalizePromoCode(code);
    if (!normalized) {
      return { ok: false, message: "Enter a promo code." };
    }
    const result = redeemPromoCode(state, normalized, nowMs());
    if (!result.ok) {
      return { ok: false, message: "That promo code isn’t valid." };
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
      selectPlan,
      requirePro,
      openSoftPaywall,
      closeSoftPaywall,
      redeemPromo,
    }),
    [
      hydrated,
      entitlement,
      selectPlan,
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
