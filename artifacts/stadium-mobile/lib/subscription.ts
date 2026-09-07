export const PREMIUM_ENTITLEMENT_ID = "premium";

export const PREMIUM_PRODUCT_IDS = [
  "com.stadiumedge.premium.monthly",
  "com.stadiumedge.premium.weekly",
] as const;

export type PremiumAccessState = "inactive" | "active" | "cancelled" | "billing_retry";
export type PurchaseOutcome = "purchased" | "cancelled" | "failed";

type EntitlementSnapshot = {
  willRenew?: boolean;
  billingIssueDetectedAt?: string | null;
};

type CustomerInfoSnapshot = {
  entitlements?: {
    active?: Record<string, EntitlementSnapshot | undefined>;
  };
};

/**
 * RevenueCat keeps an entitlement in `active` for paid access that remains
 * valid after cancellation and during Apple's billing-retry/grace window.
 */
export function premiumAccessState(info: CustomerInfoSnapshot | null | undefined): PremiumAccessState {
  const entitlement = info?.entitlements?.active?.[PREMIUM_ENTITLEMENT_ID];
  if (!entitlement) return "inactive";
  if (entitlement.billingIssueDetectedAt) return "billing_retry";
  if (entitlement.willRenew === false) return "cancelled";
  return "active";
}

export function hasPremiumAccess(info: CustomerInfoSnapshot | null | undefined): boolean {
  return premiumAccessState(info) !== "inactive";
}

export function isSupportedPremiumProduct(productIdentifier: string | null | undefined): boolean {
  return !!productIdentifier && PREMIUM_PRODUCT_IDS.includes(productIdentifier as (typeof PREMIUM_PRODUCT_IDS)[number]);
}

export function isPurchaseCancelled(error: unknown, cancelledErrorCode: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const purchaseError = error as { code?: unknown; userCancelled?: unknown };
  return purchaseError.userCancelled === true || purchaseError.code === cancelledErrorCode;
}
