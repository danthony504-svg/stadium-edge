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
  clearCustomPromoUnlock,
  clearLocalTrialEntitlement,
  clearUnverifiedPaidPlan,
  sanitizeSubscriptionState,
  softRequirePro,
} from "@/lib/entitlements";
import { hasCoachPremiumAccess } from "@/lib/coachPremiumGate";
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
import {
  resolveBillingAuth,
  shouldUnlockFromServerVerify,
} from "@/lib/purchaseAuthGate";
import {
  fetchServerAccessFlags,
  syncSubscriptionToServer,
  verifyRestoredSubscriptionOnServer,
} from "@/lib/subscriptionApi";

type RedeemResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type PurchaseActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      cancelled?: boolean;
      /** Caller should open Clerk sign-in (do not start StoreKit). */
      needsSignIn?: boolean;
      message: string;
    };

type SubscriptionContextValue = {
  hydrated: boolean;
  entitlement: EntitlementView;
  /**
   * Coach premium (picks/lines/odds/grades/breakdowns): signed-in + verified
   * StoreKit Go/Pro, admin, or designated App Review account. Never unlocked
   * by EXPO_PUBLIC_APP_REVIEW_MODE.
   */
  coachPremiumUnlocked: boolean;
  /** True when this native build can open Apple StoreKit billing. */
  storeKitReady: boolean;
  /** Why StoreKit is unavailable (null when ready). */
  storeKitBlockedReason: string | null;
  /** Apple subscription management URL from StoreKit when available. */
  storeKitManagementUrl: string | null;
  /** Busy while a purchase or restore is in flight. */
  billingBusy: boolean;
  /**
   * Purchase Go/Pro via Apple StoreKit / RevenueCat. Never grants paid access
   * from a local or preview fallback — if StoreKit is unavailable, returns an
   * error. Real access also comes from Restore Purchases or admin allowlist.
   */
  selectPlan: (planId: PlanId) => Promise<PurchaseActionResult>;
  /** Restore App Store purchases (also listed under Settings → Subscriptions). */
  restorePurchasesAction: () => Promise<PurchaseActionResult>;
  /** Soft gate: true if allowed; false opens dismissible paywall. */
  requirePro: (featureLabel?: SoftProFeatureLabel) => boolean;
  openSoftPaywall: (featureLabel?: SoftProFeatureLabel) => void;
  closeSoftPaywall: () => void;
  /**
   * Custom promo redeem is disabled (Guideline 3.1.1). Always returns failure.
   * Kept on the context type so older call sites do not crash.
   */
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

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const [state, setState] = useState<SubscriptionPersistedState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [gatedFeature, setGatedFeature] = useState("");
  const [tick, setTick] = useState(0);
  const [billingBusy, setBillingBusy] = useState(false);
  const [storeKitReady, setStoreKitReady] = useState(false);
  /** Server-verified App Review / owner access — never from EXPO_PUBLIC emails. */
  const [serverAppReviewAccess, setServerAppReviewAccess] = useState(false);
  const [serverOwnerAccess, setServerOwnerAccess] = useState(false);
  const loaded = useRef(false);

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null;
  // Do not probe Purchases during first render — NativeModules read is sync/safe;
  // memoize so we never accidentally re-enter require paths.
  const storeKitBlockedReason = useMemo(() => storeKitUnavailableReason(), []);

  const applySnapshot = useCallback((snapshot: StoreKitCustomerSnapshot) => {
    setState((prev) => applyStoreKitSnapshot(prev, snapshot));
  }, []);

  /**
   * Sync + server-verify before unlocking paid UI. Fail closed when verify
   * cannot confirm Go/Pro — never grant from client claims alone.
   */
  const applyVerifiedSnapshot = useCallback(
    async (
      snapshot: StoreKitCustomerSnapshot,
    ): Promise<"unlocked" | "inactive" | "unverified"> => {
      await syncSubscriptionToServer(snapshot);
      const verified = await verifyRestoredSubscriptionOnServer();
      if (shouldUnlockFromServerVerify(verified)) {
        applySnapshot({
          ...snapshot,
          planId: verified.planId,
        });
        return "unlocked";
      }
      if (snapshot.planId == null || verified.storeKitActive === false) {
        applySnapshot({
          planId: null,
          activeProductIds: [],
          activeEntitlementIds: [],
          originalAppUserId: snapshot.originalAppUserId,
          managementUrl: snapshot.managementUrl,
        });
        return "inactive";
      }
      return "unverified";
    },
    [applySnapshot],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
        const parsed = raw ? sanitizeSubscriptionState(JSON.parse(raw)) : DEFAULT_STATE;
        // Drop legacy local trial, unverified Go/Pro preview, and custom promo unlocks.
        const cleaned = clearCustomPromoUnlock(
          clearUnverifiedPaidPlan(clearLocalTrialEntitlement(parsed)),
        );
        if (!cancelled) setState(cleaned);
      } catch {
        if (!cancelled) {
          setState(
            clearCustomPromoUnlock(
              clearUnverifiedPaidPlan(clearLocalTrialEntitlement(DEFAULT_STATE)),
            ),
          );
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
  // Signed-out: anonymous configure is OK for catalog prices only — do not unlock paid.
  useEffect(() => {
    if (!hydrated || !authLoaded) return;
    let cancelled = false;
    (async () => {
      const ready = await configurePurchases(isSignedIn ? userId : null);
      if (cancelled) return;
      setStoreKitReady(ready && isStoreKitAvailable());
      if (!ready) return;
      if (!isSignedIn || !userId) {
        // Drop any stale local paid unlock when signed out.
        setState((prev) =>
          prev.storeKitActive
            ? applyStoreKitSnapshot(prev, {
                planId: null,
                activeProductIds: [],
                managementUrl: prev.storeKitManagementUrl,
              })
            : prev,
        );
        return;
      }
      const snapshot = await refreshCustomerSnapshot();
      if (!cancelled && snapshot) {
        await applyVerifiedSnapshot(snapshot);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, authLoaded, isSignedIn, userId, applyVerifiedSnapshot]);

  useEffect(() => {
    if (!hydrated || !storeKitReady || !isSignedIn || !userId) return;
    return addCustomerInfoListener((snapshot) => {
      void applyVerifiedSnapshot(snapshot);
    });
  }, [hydrated, storeKitReady, isSignedIn, userId, applyVerifiedSnapshot]);

  // Server-verified privileged flags (fail closed when unsigned / error).
  useEffect(() => {
    if (!hydrated) return;
    if (!isSignedIn || !userId) {
      setServerAppReviewAccess(false);
      setServerOwnerAccess(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const flags = await fetchServerAccessFlags();
      if (cancelled) return;
      setServerAppReviewAccess(flags?.appReviewAccess === true);
      setServerOwnerAccess(flags?.ownerAccess === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, isSignedIn, userId]);

  // Refresh trial/promo countdown roughly once an hour while mounted.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const entitlement = useMemo(
    () =>
      buildEntitlementView(state, nowMs(), {
        email: isSignedIn ? email : null,
        serverAppReviewAccess: isSignedIn && serverAppReviewAccess,
        serverOwnerAccess: isSignedIn && serverOwnerAccess,
        // Legacy flag ignored inside hasProAccess — proves old OTAs stay locked.
        appReviewMode:
          (process.env.EXPO_PUBLIC_APP_REVIEW_MODE ?? "").trim().toLowerCase() === "true",
      }),
    // tick forces recompute after long sessions
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, tick, isSignedIn, email, serverAppReviewAccess, serverOwnerAccess],
  );

  /** Coach premium: StoreKit / server-verified owner or App Review only. */
  const coachPremiumUnlocked = useMemo(
    () =>
      hasCoachPremiumAccess(state, nowMs(), {
        signedIn: !!isSignedIn,
        email: isSignedIn ? email : null,
        serverAppReviewAccess: isSignedIn && serverAppReviewAccess,
        serverOwnerAccess: isSignedIn && serverOwnerAccess,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, tick, isSignedIn, email, serverAppReviewAccess, serverOwnerAccess],
  );

  const selectPlan = useCallback(
    async (planId: PlanId): Promise<PurchaseActionResult> => {
      if (planId === "free") {
        const auth = resolveBillingAuth({
          authLoaded: !!authLoaded,
          isSignedIn: !!isSignedIn,
          userId,
        });
        if (auth.ok && storeKitReady) {
          const snapshot = await refreshCustomerSnapshot();
          if (snapshot?.planId) {
            const outcome = await applyVerifiedSnapshot(snapshot);
            if (outcome === "unlocked") {
              return {
                ok: true,
                message:
                  "You still have an active Apple subscription. Manage it in Settings → Subscriptions.",
              };
            }
          }
        }
        setState((prev) => ({
          ...prev,
          planId: "free",
          storeKitActive: false,
          storeKitProductId: null,
        }));
        return { ok: true, message: "Free plan selected." };
      }

      const auth = resolveBillingAuth({
        authLoaded: !!authLoaded,
        isSignedIn: !!isSignedIn,
        userId,
      });
      if (!auth.ok) {
        return {
          ok: false,
          needsSignIn: auth.reason === "signed_out" || auth.reason === "missing_user_id",
          message: auth.message,
        };
      }

      if (!storeKitReady) {
        // Never grant Go/Pro from a local/preview fallback — Apple/RC only.
        return {
          ok: false,
          message:
            storeKitBlockedReason ??
            "Apple billing is unavailable on this build. Paid plans require StoreKit / RevenueCat.",
        };
      }

      setBillingBusy(true);
      try {
        const result = await purchasePlan(planId, { appUserId: auth.userId });
        if (!result.ok) {
          return {
            ok: false,
            cancelled: result.cancelled,
            message: result.message,
          };
        }
        const outcome = await applyVerifiedSnapshot(result.snapshot);
        if (outcome !== "unlocked") {
          return {
            ok: false,
            message:
              "Purchase completed but entitlement verification is still pending. Tap Restore Purchases in a moment.",
          };
        }
        const name = planId === "pro" ? "Stadium Edge Pro" : "Stadium Edge Go";
        return {
          ok: true,
          message: `${name} is active via Apple. It appears under Settings → Subscriptions.`,
        };
      } finally {
        setBillingBusy(false);
      }
    },
    [
      authLoaded,
      isSignedIn,
      userId,
      storeKitReady,
      storeKitBlockedReason,
      applyVerifiedSnapshot,
    ],
  );

  const restorePurchasesAction = useCallback(async (): Promise<PurchaseActionResult> => {
    const auth = resolveBillingAuth({
      authLoaded: !!authLoaded,
      isSignedIn: !!isSignedIn,
      userId,
    });
    if (!auth.ok) {
      return {
        ok: false,
        needsSignIn: auth.reason === "signed_out" || auth.reason === "missing_user_id",
        message: auth.message,
      };
    }
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
      const result = await restorePurchases({ appUserId: auth.userId });
      if (!result.ok) return { ok: false, message: result.message };
      if (!result.restored) {
        await applyVerifiedSnapshot(result.snapshot);
        return {
          ok: true,
          message: "No active Apple subscriptions found for this Apple ID.",
        };
      }
      const outcome = await applyVerifiedSnapshot(result.snapshot);
      if (outcome !== "unlocked") {
        return {
          ok: false,
          message:
            "Apple returned a purchase but server verification failed. Try again shortly.",
        };
      }
      return {
        ok: true,
        message: "Purchases restored. Manage renewals in Settings → Subscriptions.",
      };
    } finally {
      setBillingBusy(false);
    }
  }, [
    authLoaded,
    isSignedIn,
    userId,
    storeKitReady,
    storeKitBlockedReason,
    applyVerifiedSnapshot,
  ]);

  const redeemPromo = useCallback((_code: string): RedeemResult => {
    // Guideline 3.1.1 — no custom redeem path; use Apple Offer Codes in ASC.
    return {
      ok: false,
      message: "Promo codes are not available. Subscribe through Apple on this screen.",
    };
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

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      hydrated,
      entitlement,
      coachPremiumUnlocked,
      storeKitReady,
      storeKitBlockedReason,
      storeKitManagementUrl: state.storeKitManagementUrl,
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
      coachPremiumUnlocked,
      storeKitReady,
      storeKitBlockedReason,
      state.storeKitManagementUrl,
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
