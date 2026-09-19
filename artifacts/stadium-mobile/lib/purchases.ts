/**
 * RevenueCat / StoreKit client wrapper.
 *
 * Uses react-native-purchases (native module). On web, Expo Go, or when
 * EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is missing, every call no-ops safely so
 * the soft local entitlement layer still works.
 */

import { Platform } from "react-native";

import type { PlanId } from "./entitlements";
import {
  ALL_STOREKIT_PRODUCT_IDS,
  planIdFromEntitlements,
  productIdForPlan,
  type StoreKitProductId,
} from "./storekitProducts";

export type StoreKitCustomerSnapshot = {
  planId: PlanId | null;
  activeProductIds: string[];
  activeEntitlementIds: string[];
  originalAppUserId: string | null;
  managementUrl: string | null;
};

export type PurchaseResult =
  | { ok: true; snapshot: StoreKitCustomerSnapshot }
  | { ok: false; cancelled: boolean; message: string };

export type RestoreResult =
  | { ok: true; snapshot: StoreKitCustomerSnapshot; restored: boolean }
  | { ok: false; message: string };

type PurchasesModule = typeof import("react-native-purchases").default;
type CustomerInfo = import("react-native-purchases").CustomerInfo;
type PurchasesStoreProduct = import("react-native-purchases").PurchasesStoreProduct;

let purchasesMod: PurchasesModule | null | undefined;
let configured = false;
let configureAttempted = false;

function iosApiKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "").trim();
}

function loadPurchases(): PurchasesModule | null {
  if (purchasesMod !== undefined) return purchasesMod;
  if (Platform.OS === "web") {
    purchasesMod = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-purchases");
    purchasesMod = (mod.default ?? mod) as PurchasesModule;
    return purchasesMod;
  } catch {
    purchasesMod = null;
    return null;
  }
}

/** True when native StoreKit purchases can run on this build. */
export function isStoreKitAvailable(): boolean {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  if (!iosApiKey()) return false;
  return loadPurchases() != null;
}

export function storeKitUnavailableReason(): string | null {
  if (Platform.OS === "web") {
    return "Apple subscriptions require the iOS app.";
  }
  if (!iosApiKey()) {
    return "StoreKit is not configured on this build yet (missing RevenueCat API key).";
  }
  if (loadPurchases() == null) {
    return "StoreKit needs a native rebuild — this JS update alone cannot open Apple billing.";
  }
  return null;
}

function snapshotFromCustomerInfo(info: CustomerInfo): StoreKitCustomerSnapshot {
  const activeEntitlementIds = Object.keys(info.entitlements.active ?? {});
  const activeProductIds = [
    ...new Set(
      Object.values(info.entitlements.active ?? {})
        .map((e) => e.productIdentifier)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  // Also include activeSubscriptions when entitlements are misconfigured in RC.
  for (const id of info.activeSubscriptions ?? []) {
    if (id && !activeProductIds.includes(id)) activeProductIds.push(id);
  }
  return {
    planId: planIdFromEntitlements(activeEntitlementIds, activeProductIds),
    activeProductIds,
    activeEntitlementIds,
    originalAppUserId: info.originalAppUserId ?? null,
    managementUrl: info.managementURL ?? null,
  };
}

/**
 * Configure Purchases once per process. Safe to call repeatedly.
 * Pass Clerk user id when signed in so purchases attach to the account.
 */
export async function configurePurchases(
  appUserId: string | null | undefined,
): Promise<boolean> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  const apiKey = iosApiKey();
  const Purchases = loadPurchases();
  if (!Purchases || !apiKey) {
    configureAttempted = true;
    return false;
  }
  try {
    const already = await Purchases.isConfigured();
    if (!already) {
      Purchases.configure({
        apiKey,
        appUserID: appUserId?.trim() || undefined,
      });
      configured = true;
    } else if (appUserId?.trim()) {
      await Purchases.logIn(appUserId.trim());
      configured = true;
    } else {
      configured = true;
    }
    configureAttempted = true;
    return true;
  } catch {
    configureAttempted = true;
    configured = false;
    return false;
  }
}

export async function refreshCustomerSnapshot(): Promise<StoreKitCustomerSnapshot | null> {
  const Purchases = loadPurchases();
  if (!Purchases || (!configured && !configureAttempted)) return null;
  try {
    if (!(await Purchases.isConfigured())) return null;
    const info = await Purchases.getCustomerInfo();
    return snapshotFromCustomerInfo(info);
  } catch {
    return null;
  }
}

async function findStoreProduct(
  productId: StoreKitProductId,
): Promise<PurchasesStoreProduct | null> {
  const Purchases = loadPurchases();
  if (!Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (current) {
      for (const pkg of current.availablePackages ?? []) {
        if (pkg.product?.identifier === productId) return pkg.product;
      }
    }
    for (const offering of Object.values(offerings.all ?? {})) {
      for (const pkg of offering.availablePackages ?? []) {
        if (pkg.product?.identifier === productId) return pkg.product;
      }
    }
    const products = await Purchases.getProducts([...ALL_STOREKIT_PRODUCT_IDS]);
    return products.find((p) => p.identifier === productId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Start an Apple StoreKit purchase for Go or Pro.
 * Free trial stays local (no StoreKit product).
 */
export async function purchasePlan(planId: PlanId): Promise<PurchaseResult> {
  const productId = productIdForPlan(planId);
  if (!productId) {
    return { ok: false, cancelled: false, message: "That plan does not require Apple billing." };
  }
  const unavailable = storeKitUnavailableReason();
  if (unavailable) {
    return { ok: false, cancelled: false, message: unavailable };
  }
  const Purchases = loadPurchases();
  if (!Purchases) {
    return {
      ok: false,
      cancelled: false,
      message: "StoreKit is unavailable on this build.",
    };
  }
  try {
    if (!(await Purchases.isConfigured())) {
      const ok = await configurePurchases(null);
      if (!ok) {
        return {
          ok: false,
          cancelled: false,
          message: "Could not start Apple billing on this device.",
        };
      }
    }
    const product = await findStoreProduct(productId);
    if (!product) {
      return {
        ok: false,
        cancelled: false,
        message:
          "That subscription is not live in App Store Connect / RevenueCat yet. Create the products, then rebuild.",
      };
    }
    const { customerInfo } = await Purchases.purchaseStoreProduct(product);
    return { ok: true, snapshot: snapshotFromCustomerInfo(customerInfo) };
  } catch (err: unknown) {
    const anyErr = err as { userCancelled?: boolean; message?: string; code?: string };
    if (anyErr?.userCancelled) {
      return { ok: false, cancelled: true, message: "Purchase cancelled." };
    }
    return {
      ok: false,
      cancelled: false,
      message: anyErr?.message || "Purchase failed. Try again or restore purchases.",
    };
  }
}

export async function restorePurchases(): Promise<RestoreResult> {
  const unavailable = storeKitUnavailableReason();
  if (unavailable) {
    return { ok: false, message: unavailable };
  }
  const Purchases = loadPurchases();
  if (!Purchases) {
    return { ok: false, message: "StoreKit is unavailable on this build." };
  }
  try {
    if (!(await Purchases.isConfigured())) {
      const ok = await configurePurchases(null);
      if (!ok) return { ok: false, message: "Could not restore on this device." };
    }
    const info = await Purchases.restorePurchases();
    const snapshot = snapshotFromCustomerInfo(info);
    return {
      ok: true,
      snapshot,
      restored: snapshot.planId != null,
    };
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Restore failed.";
    return { ok: false, message };
  }
}

/** Optional listener for renewals / expirations while the app is open. */
export function addCustomerInfoListener(
  onUpdate: (snapshot: StoreKitCustomerSnapshot) => void,
): () => void {
  const Purchases = loadPurchases();
  if (!Purchases) return () => {};
  const listener = (info: CustomerInfo) => {
    onUpdate(snapshotFromCustomerInfo(info));
  };
  try {
    Purchases.addCustomerInfoUpdateListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      Purchases.removeCustomerInfoUpdateListener(listener);
    } catch {
      // ignore
    }
  };
}
