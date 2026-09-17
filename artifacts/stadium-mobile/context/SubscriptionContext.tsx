import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "expo-router";

import { SoftPaywallModal } from "@/components/SoftPaywallModal";
import {
  SUBSCRIPTION_STORAGE_KEY,
  type EntitlementView,
  type PlanId,
  type SoftProFeatureLabel,
  type SubscriptionPersistedState,
  buildEntitlementView,
  ensureTrialStarted,
  sanitizeSubscriptionState,
  softRequirePro,
} from "@/lib/entitlements";

type SubscriptionContextValue = {
  hydrated: boolean;
  entitlement: EntitlementView;
  /** Local preview plan selection — no StoreKit charge. */
  selectPlan: (planId: PlanId) => void;
  /** Soft gate: true if allowed; false opens dismissible paywall. */
  requirePro: (featureLabel?: SoftProFeatureLabel) => boolean;
  openSoftPaywall: (featureLabel?: SoftProFeatureLabel) => void;
  closeSoftPaywall: () => void;
};

const DEFAULT_STATE: SubscriptionPersistedState = {
  planId: "free",
  trialStartedAtMs: null,
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

function nowMs() {
  return Date.now();
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SubscriptionPersistedState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [gatedFeature, setGatedFeature] = useState("");
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);

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

  // Refresh trial countdown roughly once an hour while mounted.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const entitlement = useMemo(
    () => buildEntitlementView(state, nowMs()),
    // tick forces recompute after long sessions
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, tick],
  );

  const selectPlan = useCallback((planId: PlanId) => {
    setState((prev) => ({ ...prev, planId }));
  }, []);

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
    // Trial already started on first hydrate; just dismiss. If somehow missing, stamp it.
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
    }),
    [hydrated, entitlement, selectPlan, requirePro, openSoftPaywall, closeSoftPaywall],
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
