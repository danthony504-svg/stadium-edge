import {
  PREMIUM_ENTITLEMENT_ID,
  PREMIUM_PRODUCT_IDS,
  hasPremiumAccess,
  isPurchaseCancelled,
  isSupportedPremiumProduct,
  premiumAccessState,
  shouldRefreshSubscriptionEntitlement,
} from "./subscription";

const customerInfo = (entitlement?: { willRenew?: boolean; billingIssueDetectedAt?: string | null }) => ({
  entitlements: { active: entitlement ? { [PREMIUM_ENTITLEMENT_ID]: entitlement } : {} },
});

test("declares the single premium entitlement and supported StoreKit products", () => {
  expect(PREMIUM_ENTITLEMENT_ID).toBe("premium");
  expect(PREMIUM_PRODUCT_IDS).toEqual([
    "com.stadiumedge.premium.monthly",
    "com.stadiumedge.premium.weekly",
  ]);
  expect(isSupportedPremiumProduct("com.stadiumedge.premium.monthly")).toBe(true);
  expect(isSupportedPremiumProduct("com.stadiumedge.premium.weekly")).toBe(true);
  expect(isSupportedPremiumProduct("com.stadiumedge.premium.annual")).toBe(false);
});

test("keeps cancelled subscriptions active through their paid period", () => {
  const info = customerInfo({ willRenew: false });
  expect(premiumAccessState(info)).toBe("cancelled");
  expect(hasPremiumAccess(info)).toBe(true);
});

test("keeps billing-retry or grace-period entitlements active", () => {
  const info = customerInfo({ willRenew: false, billingIssueDetectedAt: "2026-09-07T00:00:00Z" });
  expect(premiumAccessState(info)).toBe("billing_retry");
  expect(hasPremiumAccess(info)).toBe(true);
  expect(premiumAccessState(customerInfo())).toBe("inactive");
  expect(hasPremiumAccess(customerInfo())).toBe(false);
});

test("recognizes user cancellations separately from purchase failures", () => {
  expect(isPurchaseCancelled({ code: "cancelled" }, "cancelled")).toBe(true);
  expect(isPurchaseCancelled({ userCancelled: true }, "other")).toBe(true);
  expect(isPurchaseCancelled({ code: "store_problem" }, "cancelled")).toBe(false);
});

test("refreshes RevenueCat entitlement state when the native app resumes", () => {
  expect(shouldRefreshSubscriptionEntitlement("active")).toBe(true);
  expect(shouldRefreshSubscriptionEntitlement("inactive")).toBe(false);
  expect(shouldRefreshSubscriptionEntitlement("background")).toBe(false);
});
