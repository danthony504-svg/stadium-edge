/**
 * Apple App Store Connect product catalog for Stadium Edge subscriptions.
 *
 * These IDs must match auto-renewable subscription products created in
 * App Store Connect (and mirrored in RevenueCat). Purchasing them via
 * StoreKit is what makes Stadium Edge appear under iOS Settings →
 * Apple ID → Subscriptions (same list as ChatGPT / Claude / Replit).
 *
 * Native rebuild + runtimeVersion bump required — do not ship via OTA alone.
 */

import type { PlanId } from "./entitlements";

/** App Store Connect product identifiers. */
export const STOREKIT_PRODUCT_IDS = {
  goWeekly: "com.stadiumedge.app.go.weekly",
  proMonthly: "com.stadiumedge.app.pro.monthly",
} as const;

export type StoreKitProductId =
  (typeof STOREKIT_PRODUCT_IDS)[keyof typeof STOREKIT_PRODUCT_IDS];

/** RevenueCat entitlement identifiers (configure identically in the RC dashboard). */
export const STOREKIT_ENTITLEMENT_IDS = {
  go: "go",
  pro: "pro",
} as const;

export type StoreKitEntitlementId =
  (typeof STOREKIT_ENTITLEMENT_IDS)[keyof typeof STOREKIT_ENTITLEMENT_IDS];

/** Map paid PlanId → App Store product id. Free trial is local-only. */
export function productIdForPlan(planId: PlanId): StoreKitProductId | null {
  if (planId === "go") return STOREKIT_PRODUCT_IDS.goWeekly;
  if (planId === "pro") return STOREKIT_PRODUCT_IDS.proMonthly;
  return null;
}

export function planIdForProductId(
  productId: string | null | undefined,
): PlanId | null {
  if (!productId) return null;
  if (productId === STOREKIT_PRODUCT_IDS.goWeekly) return "go";
  if (productId === STOREKIT_PRODUCT_IDS.proMonthly) return "pro";
  return null;
}

/**
 * Resolve active plan from RevenueCat entitlement map.
 * Pro wins over Go when both are active.
 */
export function planIdFromEntitlements(
  activeEntitlementIds: readonly string[],
  activeProductIds: readonly string[] = [],
): PlanId | null {
  const set = new Set(activeEntitlementIds.map((id) => id.toLowerCase()));
  if (set.has(STOREKIT_ENTITLEMENT_IDS.pro)) return "pro";
  if (set.has(STOREKIT_ENTITLEMENT_IDS.go)) return "go";

  for (const productId of activeProductIds) {
    const fromProduct = planIdForProductId(productId);
    if (fromProduct === "pro") return "pro";
  }
  for (const productId of activeProductIds) {
    const fromProduct = planIdForProductId(productId);
    if (fromProduct === "go") return "go";
  }
  return null;
}

export const ALL_STOREKIT_PRODUCT_IDS: readonly StoreKitProductId[] = [
  STOREKIT_PRODUCT_IDS.goWeekly,
  STOREKIT_PRODUCT_IDS.proMonthly,
];
