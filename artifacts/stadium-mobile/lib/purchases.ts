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

/** StoreKit catalog row for Plans UI (price + intro/trial honesty). */
export type StoreKitCatalogProduct = {
  productId: StoreKitProductId;
  planId: PlanId;
  /** Localized App Store price string when available. */
  priceString: string | null;
  /** True when Apple reports a free introductory offer (trial) on this product. */
  hasFreeTrial: boolean;
  /** Intro period length in days when a free trial is present (best-effort). */
  freeTrialDays: number | null;
};

export type StoreKitCatalog = {
  go: StoreKitCatalogProduct | null;
  pro: StoreKitCatalogProduct | null;
};

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
 * Anonymous configure (null) is allowed for catalog/price display only —
 * purchase and restore must call ensurePurchasesIdentity first.
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

/**
 * Identify RevenueCat with the authenticated Clerk user id before buy/restore.
 * Aliases any current anonymous RC user onto this Clerk id (same-device resume).
 * Does not invent a user id and refuses empty ids so purchases cannot attach
 * to an anonymous bucket after sign-in.
 */
export async function ensurePurchasesIdentity(
  appUserId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = typeof appUserId === "string" ? appUserId.trim() : "";
  if (!id) {
    return {
      ok: false,
      message: "Sign in required before Apple billing can start.",
    };
  }
  const unavailable = storeKitUnavailableReason();
  if (unavailable) return { ok: false, message: unavailable };
  try {
    const ready = await configurePurchases(id);
    if (!ready) {
      return {
        ok: false,
        message: "Could not connect Apple billing to your account.",
      };
    }
    const Purchases = loadPurchases();
    if (!Purchases || !(await Purchases.isConfigured())) {
      return {
        ok: false,
        message: "Could not connect Apple billing to your account.",
      };
    }
    // Always logIn when already configured so we never purchase as anonymous
    // after the user has authenticated.
    await Purchases.logIn(id);
    return { ok: true };
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Could not connect Apple billing to your account.";
    return { ok: false, message };
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

function freeTrialDaysFromIntro(
  intro: PurchasesStoreProduct["introPrice"],
): number | null {
  if (!intro || intro.price !== 0) return null;
  const unit = (intro.periodUnit ?? "").toUpperCase();
  const n = intro.periodNumberOfUnits ?? 0;
  if (!n || n < 1) return null;
  if (unit === "DAY") return n * (intro.cycles || 1);
  if (unit === "WEEK") return n * 7 * (intro.cycles || 1);
  if (unit === "MONTH") return n * 30 * (intro.cycles || 1);
  return null;
}

function catalogRowFromProduct(
  planId: PlanId,
  productId: StoreKitProductId,
  product: PurchasesStoreProduct | null,
): StoreKitCatalogProduct | null {
  if (!product) return null;
  const intro = product.introPrice;
  const hasFreeTrial = !!intro && intro.price === 0;
  return {
    productId,
    planId,
    priceString: product.priceString ?? null,
    hasFreeTrial,
    freeTrialDays: hasFreeTrial ? freeTrialDaysFromIntro(intro) : null,
  };
}

/**
 * Load Go/Pro StoreKit product metadata for honest price/trial display.
 * Returns null rows when StoreKit is unavailable or products are not loaded.
 */
export async function fetchStoreKitCatalog(): Promise<StoreKitCatalog> {
  const empty: StoreKitCatalog = { go: null, pro: null };
  if (!isStoreKitAvailable()) return empty;
  try {
    if (!(await configurePurchases(null))) return empty;
    const goId = productIdForPlan("go");
    const proId = productIdForPlan("pro");
    if (!goId || !proId) return empty;
    const [goProduct, proProduct] = await Promise.all([
      findStoreProduct(goId),
      findStoreProduct(proId),
    ]);
    return {
      go: catalogRowFromProduct("go", goId, goProduct),
      pro: catalogRowFromProduct("pro", proId, proProduct),
    };
  } catch {
    return empty;
  }
}

export type PurchaseIdentityOpts = {
  /** Authenticated Clerk user id — required. */
  appUserId: string;
};

/**
 * Start an Apple StoreKit purchase for Go or Pro.
 * Free trial is an Apple introductory offer on Go/Pro (ASC) — not a local product.
 * Requires an authenticated Clerk user id so RevenueCat never bills anonymously.
 */
export async function purchasePlan(
  planId: PlanId,
  opts: PurchaseIdentityOpts,
): Promise<PurchaseResult> {
  const productId = productIdForPlan(planId);
  if (!productId) {
    return { ok: false, cancelled: false, message: "That plan does not require Apple billing." };
  }
  const identified = await ensurePurchasesIdentity(opts.appUserId);
  if (!identified.ok) {
    return { ok: false, cancelled: false, message: identified.message };
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
    const product = await findStoreProduct(productId);
    if (!product) {
      return {
        ok: false,
        cancelled: false,
        message:
          "That subscription is not available right now. Try again or Restore Purchases.",
      };
    }
    const { customerInfo } = await Purchases.purchaseStoreProduct(product);
    return { ok: true, snapshot: snapshotFromCustomerInfo(customerInfo) };
  } catch (err: unknown) {
    const anyErr = err as { userCancelled?: boolean; message?: string; code?: string };
    if (anyErr?.userCancelled) {
      return { ok: false, cancelled: true, message: "Purchase cancelled." };
    }
    // Common when the Apple ID already owns the subscription — surface restore.
    const code = String(anyErr?.code ?? "");
    const msg = anyErr?.message || "Purchase failed. Try again or restore purchases.";
    if (/already\s+purchased|productAlreadyPurchased|RECEIPT_ALREADY_IN_USE/i.test(`${code} ${msg}`)) {
      return {
        ok: false,
        cancelled: false,
        message:
          "This Apple ID already has a Stadium Edge subscription. Use Restore Purchases.",
      };
    }
    return {
      ok: false,
      cancelled: false,
      message: msg,
    };
  }
}

/**
 * Restore App Store purchases for the authenticated Clerk user.
 * Identifies RevenueCat with appUserId first so restores attach to that account.
 */
export async function restorePurchases(
  opts: PurchaseIdentityOpts,
): Promise<RestoreResult> {
  const identified = await ensurePurchasesIdentity(opts.appUserId);
  if (!identified.ok) {
    return { ok: false, message: identified.message };
  }
  const Purchases = loadPurchases();
  if (!Purchases) {
    return { ok: false, message: "StoreKit is unavailable on this build." };
  }
  try {
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
