import { useAuth } from "@clerk/expo";
import Purchases, {
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesPackage,
} from "react-native-purchases";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import {
  hasPremiumAccess,
  isPurchaseCancelled,
  isSupportedPremiumProduct,
  premiumAccessState,
  shouldRefreshSubscriptionEntitlement,
  type PremiumAccessState,
  type PurchaseOutcome,
} from "@/lib/subscription";

const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() ?? "";

type PurchaseResult = {
  outcome: PurchaseOutcome;
  error?: Error;
};

type SubscriptionState = {
  loading: boolean;
  purchasing: boolean;
  isConfigured: boolean;
  premiumActive: boolean;
  premiumAccessState: PremiumAccessState;
  availablePackages: PurchasesPackage[];
  error: Error | null;
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseResult>;
  restorePurchases: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionState | null>(null);

function supportedPackages(packages: PurchasesPackage[]): PurchasesPackage[] {
  return packages.filter((pkg) => isSupportedPremiumProduct(pkg.product.identifier));
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, userId } = useAuth();
  const configured = useRef(false);
  const customerInfoListener = useRef<((info: CustomerInfo) => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [premiumActive, setPremiumActive] = useState(false);
  const [premiumState, setPremiumState] = useState<PremiumAccessState>("inactive");
  const [availablePackages, setAvailablePackages] = useState<PurchasesPackage[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const applyCustomerInfo = useCallback((info: CustomerInfo) => {
    setPremiumActive(hasPremiumAccess(info));
    setPremiumState(premiumAccessState(info));
  }, []);

  const refreshEntitlement = useCallback(async () => {
    if (!configured.current) return;
    const [info, offerings] = await Promise.all([Purchases.getCustomerInfo(), Purchases.getOfferings()]);
    applyCustomerInfo(info);
    setAvailablePackages(supportedPackages(offerings.current?.availablePackages ?? []));
  }, [applyCustomerInfo]);

  useEffect(() => {
    if (Platform.OS !== "ios" || !REVENUECAT_IOS_API_KEY) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const initialize = async () => {
      try {
        if (!configured.current) {
          Purchases.configure({
            apiKey: REVENUECAT_IOS_API_KEY,
            ...(isSignedIn && userId ? { appUserID: userId } : {}),
          });
          configured.current = true;
          customerInfoListener.current = (info) => {
            if (mounted) applyCustomerInfo(info);
          };
          Purchases.addCustomerInfoUpdateListener(customerInfoListener.current);
        } else if (isSignedIn && userId) {
          const result = await Purchases.logIn(userId);
          applyCustomerInfo(result.customerInfo);
        } else {
          const info = await Purchases.logOut();
          applyCustomerInfo(info);
        }
        await refreshEntitlement();
        if (mounted) setIsConfigured(true);
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause : new Error("Unable to initialize subscriptions."));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void initialize();

    return () => {
      mounted = false;
      if (customerInfoListener.current) {
        Purchases.removeCustomerInfoUpdateListener(customerInfoListener.current);
        customerInfoListener.current = null;
      }
    };
  }, [applyCustomerInfo, isSignedIn, refreshEntitlement, userId]);

  // Entitlements can change while the app is backgrounded (renewal, expiry,
  // billing retry, or a StoreKit transaction completed elsewhere). Refresh the
  // RevenueCat snapshot on resume without changing any feature access here.
  useEffect(() => {
    if (Platform.OS !== "ios" || !REVENUECAT_IOS_API_KEY || !isConfigured) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (!shouldRefreshSubscriptionEntitlement(state)) return;
      void refreshEntitlement().catch((cause) => {
        setError(cause instanceof Error ? cause : new Error("Unable to refresh subscription."));
      });
    });
    return () => subscription.remove();
  }, [isConfigured, refreshEntitlement]);

  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
      if (!configured.current) {
        return { outcome: "failed", error: new Error("Subscriptions are not configured.") };
      }
      setPurchasing(true);
      setError(null);
      try {
        const result = await Purchases.purchasePackage(pkg);
        applyCustomerInfo(result.customerInfo);
        return { outcome: "purchased" };
      } catch (cause) {
        // Refresh after cancellation too: StoreKit can finalize a transaction
        // while its sheet reports cancelled on an interrupted payment flow.
        if (isPurchaseCancelled(cause, PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)) {
          try {
            await refreshEntitlement();
          } catch {
            // The cancellation outcome remains distinct even when refresh is offline.
          }
          return { outcome: "cancelled" };
        }
        const nextError = cause instanceof Error ? cause : new Error("Unable to complete purchase.");
        setError(nextError);
        return { outcome: "failed", error: nextError };
      } finally {
        setPurchasing(false);
      }
    },
    [applyCustomerInfo, refreshEntitlement],
  );

  const restorePurchases = useCallback(async () => {
    if (!configured.current) throw new Error("Subscriptions are not configured.");
    setError(null);
    try {
      applyCustomerInfo(await Purchases.restorePurchases());
      await refreshEntitlement();
    } catch (cause) {
      const nextError = cause instanceof Error ? cause : new Error("Unable to restore purchases.");
      setError(nextError);
      throw nextError;
    }
  }, [applyCustomerInfo, refreshEntitlement]);

  const value = useMemo(
    () => ({
      loading,
      purchasing,
      isConfigured,
      premiumActive,
      premiumAccessState: premiumState,
      availablePackages,
      error,
      purchase,
      restorePurchases,
      refreshEntitlement,
    }),
    [
      loading,
      purchasing,
      isConfigured,
      premiumActive,
      premiumState,
      availablePackages,
      error,
      purchase,
      restorePurchases,
      refreshEntitlement,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionState {
  const value = useContext(SubscriptionContext);
  if (!value) throw new Error("useSubscription must be used within SubscriptionProvider");
  return value;
}
