/**
 * RevenueCat / StoreKit client wrapper.
 *
 * Uses react-native-purchases (native module). On web, Expo Go, older binaries
 * without RNPurchases, or when EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is missing,
 * every call no-ops safely — callers must treat StoreKit as unavailable and
 * must not unlock Go/Pro via a local/preview fallback.
 *
 * CRITICAL: never `require("react-native-purchases")` unless NativeModules.RNPurchases
 * exists. Requiring the JS package on a binary without the native module constructs
 * `new NativeEventEmitter(undefined)` and hard-crashes launch (OTA #460/#461 onto
 * runtime 1.0.3).
 */

import { NativeModules, Platform } from "react-native";

import type { PlanId } from "./entitlements";
import {
  describePurchasesError,
  rcDiagnosticAlert,
  revenueCatKeyPrefixType,
} from "./purchasesDiagnostics";
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

/** True only when this native binary actually linked RevenueCat. */
export function hasPurchasesNativeModule(): boolean {
  try {
    return Platform.OS !== "web" && !!NativeModules.RNPurchases;
  } catch {
    return false;
  }
}

function loadPurchases(): PurchasesModule | null {
  if (purchasesMod !== undefined) return purchasesMod;
  if (Platform.OS === "web") {
    purchasesMod = null;
    return null;
  }
  // Fail closed BEFORE require — package init crashes without RNPurchases.
  if (!hasPurchasesNativeModule()) {
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
  if (!hasPurchasesNativeModule()) return false;
  return loadPurchases() != null;
}

export function storeKitUnavailableReason(): string | null {
  if (Platform.OS === "web") {
    return "Apple subscriptions require the iOS app.";
  }
  if (!iosApiKey()) {
    return "StoreKit is not configured on this build yet (missing RevenueCat API key).";
  }
  if (!hasPurchasesNativeModule()) {
    return "StoreKit needs a native rebuild — this JS update alone cannot open Apple billing.";
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
): Promise<{ product: PurchasesStoreProduct | null; diagnostic: string }> {
  const Purchases = loadPurchases();
  if (!Purchases) {
    return {
      product: null,
      diagnostic: rcDiagnosticAlert("Purchases module unavailable"),
    };
  }

  let configuredFlag = false;
  try {
    configuredFlag = await Purchases.isConfigured();
  } catch {
    configuredFlag = false;
  }

  console.log("[RC diagnostic] findStoreProduct start", {
    requestedProductId: productId,
    platform: Platform.OS,
    revenueCatConfigured: configuredFlag,
    revenueCatKeyPrefix: revenueCatKeyPrefixType(iosApiKey()),
  });

  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    const allOfferings = Object.values(offerings.all ?? {});
    const offeringSummaries = allOfferings.map((offering) => ({
      identifier: offering.identifier,
      packages: (offering.availablePackages ?? []).map((pkg) => ({
        packageIdentifier: pkg.identifier,
        productIdentifier: pkg.product?.identifier ?? null,
      })),
    }));
    console.log("[RC diagnostic] getOfferings", {
      currentOfferingIdentifier: current?.identifier ?? null,
      allOfferingIdentifiers: allOfferings.map((o) => o.identifier),
      offerings: offeringSummaries,
    });

    if (current) {
      for (const pkg of current.availablePackages ?? []) {
        if (pkg.product?.identifier === productId) {
          return { product: pkg.product, diagnostic: "" };
        }
      }
    }
    for (const offering of allOfferings) {
      for (const pkg of offering.availablePackages ?? []) {
        if (pkg.product?.identifier === productId) {
          return { product: pkg.product, diagnostic: "" };
        }
      }
    }

    const products = await Purchases.getProducts([...ALL_STOREKIT_PRODUCT_IDS]);
    console.log("[RC diagnostic] getProducts", {
      requestedIds: [...ALL_STOREKIT_PRODUCT_IDS],
      count: products.length,
      identifiers: products.map((p) => p.identifier),
      products: products.map((p) => ({
        identifier: p.identifier,
        priceString: p.priceString ?? null,
        subscriptionPeriod: p.subscriptionPeriod ?? null,
      })),
    });

    const matched = products.find((p) => p.identifier === productId) ?? null;
    if (matched) return { product: matched, diagnostic: "" };

    const currentIds =
      current?.availablePackages
        ?.map((pkg) => pkg.product?.identifier)
        .filter((id): id is string => !!id) ?? [];
    const detail =
      products.length === 0
        ? `getProducts returned 0 products (current=${current?.identifier ?? "null"}; pkgs=${currentIds.join(",") || "none"})`
        : `product ${productId} not in getProducts [${products.map((p) => p.identifier).join(",")}]`;
    console.log("[RC diagnostic] findStoreProduct miss", { detail });
    return { product: null, diagnostic: rcDiagnosticAlert(detail) };
  } catch (err) {
    const described = describePurchasesError(err);
    console.log("[RC diagnostic] findStoreProduct error", {
      code: described.code,
      message: described.message,
      underlying: described.underlying,
      serialized: described.serialized,
    });
    return {
      product: null,
      diagnostic: rcDiagnosticAlert(described.short),
    };
  }
}

/**
 * Start an Apple StoreKit purchase for Go or Pro.
 * Free trial is an Apple introductory offer on Go/Pro (ASC) — not a local product.
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
    const { product, diagnostic } = await findStoreProduct(productId);
    if (!product) {
      return {
        ok: false,
        cancelled: false,
        message:
          diagnostic ||
          rcDiagnosticAlert("product resolution failed with no detail"),
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
