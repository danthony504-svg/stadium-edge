import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLE_INTRO_TRIAL_DAYS,
  CUSTOM_PROMO_UNLOCKS_ENABLED,
  buildEntitlementView,
  buildPromoLink,
  canAccessPremiumFeature,
  clearCustomPromoUnlock,
  clearLocalTrialEntitlement,
  clearUnverifiedPaidPlan,
  extractPromoFromQuery,
  findPromoDefinition,
  hasProAccess,
  isAdminEmail,
  isAppReviewAccountEmail,
  isPlanId,
  isPromoUnlockActive,
  isTrialActive,
  parseAdminEmails,
  parseAppReviewAccountEmails,
  planById,
  premiumFeatureForRoute,
  redeemPromoCode,
  sanitizeSubscriptionState,
  softRequirePro,
  trialDaysRemaining,
  applyStoreKitSnapshot,
  type PremiumFeatureId,
} from "./entitlements.ts";

const DAY = 24 * 60 * 60 * 1000;

function baseState(over: Partial<ReturnType<typeof sanitizeSubscriptionState>> = {}) {
  return sanitizeSubscriptionState({ planId: "free", trialStartedAtMs: null, ...over });
}

test("isPlanId accepts only free/go/pro", () => {
  assert.equal(isPlanId("free"), true);
  assert.equal(isPlanId("go"), true);
  assert.equal(isPlanId("pro"), true);
  assert.equal(isPlanId("enterprise"), false);
  assert.equal(isPlanId(null), false);
});

test("local trial helpers never grant access", () => {
  const start = 1_700_000_000_000;
  assert.equal(APPLE_INTRO_TRIAL_DAYS, 7);
  assert.equal(trialDaysRemaining(start, start), 0);
  assert.equal(isTrialActive(start, start + DAY), false);
  assert.equal(
    hasProAccess(baseState({ planId: "free", trialStartedAtMs: start }), start + DAY, {}),
    false,
  );
});

test("hasProAccess: paid requires storeKitActive; custom promo never unlocks; client admin ignored", () => {
  const start = 1_700_000_000_000;
  assert.equal(CUSTOM_PROMO_UNLOCKS_ENABLED, false);
  assert.equal(
    hasProAccess(baseState({ planId: "go", storeKitActive: true }), start, {}),
    true,
  );
  assert.equal(
    hasProAccess(baseState({ planId: "go", storeKitActive: false }), start, {}),
    false,
  );
  assert.equal(
    hasProAccess(baseState({ planId: "free", trialStartedAtMs: start }), start + DAY, {}),
    false,
  );
  // Guideline 3.1.1 — stored custom promo codes must not grant Pro.
  assert.equal(
    hasProAccess(
      baseState({
        redeemedPromoCode: "7VXHVPOR",
        promoLifetime: true,
      }),
      start + 100 * DAY,
      {},
    ),
    false,
  );
  assert.equal(
    isPromoUnlockActive(
      baseState({ redeemedPromoCode: "7VXHVPOR", promoLifetime: true }),
      start,
    ),
    false,
  );
  // Adversarial: EXPO_PUBLIC_ADMIN_EMAILS / forged client email must not unlock.
  assert.equal(
    hasProAccess(baseState({ planId: "free" }), start, {
      email: "owner@example.com",
      adminEmails: ["owner@example.com", "danthony504@gmail.com"],
    }),
    false,
  );
  assert.equal(
    hasProAccess(baseState({ planId: "free" }), start, {
      serverOwnerAccess: true,
    }),
    true,
  );
});

test("hasProAccess: legacy APP_REVIEW_MODE flag never unlocks (old OTA/native)", () => {
  const start = 1_700_000_000_000;
  const free = baseState({ planId: "free" });
  assert.equal(hasProAccess(free, start, { appReviewMode: true }), false);
  const view = buildEntitlementView(free, start, { appReviewMode: true });
  assert.equal(view.isPro, false);
  assert.equal(view.unlockSource, "none");
  assert.equal(view.statusLabel, "Free");
  assert.notEqual(view.statusLabel, "Temporary unlock");
  assert.doesNotMatch(view.statusDetail, /pending App Store approval/i);
});

test("adversarial: forged client email / allowlist cannot unlock without server flag", () => {
  const start = 1_700_000_000_000;
  const free = baseState({ planId: "free" });
  const forgedAllowlist = parseAppReviewAccountEmails("apple@stadiumedge.app");
  assert.equal(
    isAppReviewAccountEmail("apple@stadiumedge.app", forgedAllowlist),
    true,
  );
  // Client claims the review email + allowlist + legacy mode — still locked.
  assert.equal(
    hasProAccess(free, start, {
      email: "apple@stadiumedge.app",
      appReviewAccountEmails: forgedAllowlist,
      appReviewMode: true,
      serverAppReviewAccess: false,
    }),
    false,
  );
  const forgedView = buildEntitlementView(free, start, {
    email: "apple@stadiumedge.app",
    appReviewAccountEmails: forgedAllowlist,
    appReviewMode: true,
  });
  assert.equal(forgedView.isPro, false);
  assert.equal(forgedView.unlockSource, "none");
  assert.equal(forgedView.statusLabel, "Free");
});

test("server-verified App Review access unlocks without fabricating Go/Pro", () => {
  const start = 1_700_000_000_000;
  const free = baseState({ planId: "free", storeKitActive: false });
  assert.equal(
    hasProAccess(free, start, { serverAppReviewAccess: true }),
    true,
  );
  const view = buildEntitlementView(free, start, {
    serverAppReviewAccess: true,
    appReviewMode: true,
    email: "not-the-reviewer@example.com",
    appReviewAccountEmails: ["apple@stadiumedge.app"],
  });
  assert.equal(view.unlockSource, "review");
  assert.equal(view.statusLabel, "App Review");
  assert.equal(view.planId, "free");
  assert.equal(view.isPro, true);
  assert.notEqual(view.statusLabel, "Temporary unlock");
  assert.notEqual(view.statusLabel, "Stadium Edge Go");
  assert.notEqual(view.statusLabel, "Stadium Edge Pro");
});

test("ordinary free account stays Free; expired StoreKit stays locked", () => {
  const start = 1_700_000_000_000;
  const freeView = buildEntitlementView(baseState({ planId: "free" }), start, {
    email: "fan@example.com",
    appReviewMode: true,
    appReviewAccountEmails: ["apple@stadiumedge.app"],
  });
  assert.equal(freeView.statusLabel, "Free");
  assert.equal(freeView.isPro, false);

  const expired = baseState({
    planId: "go",
    storeKitActive: false,
    storeKitProductId: "com.stadiumedge.app.go.weekly",
  });
  assert.equal(hasProAccess(expired, start, { appReviewMode: true }), false);
  assert.equal(
    buildEntitlementView(expired, start, { serverAppReviewAccess: false }).unlockSource,
    "none",
  );
});

test("active Go/Pro StoreKit retains access; old OTA flag cannot substitute", () => {
  const start = 1_700_000_000_000;
  const go = baseState({
    planId: "go",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.go.weekly",
  });
  const goView = buildEntitlementView(go, start, { appReviewMode: false });
  assert.equal(goView.unlockSource, "storekit");
  assert.equal(goView.statusLabel, "Stadium Edge Go");
  assert.equal(goView.isPro, true);

  // Simulates old native env still embedding APP_REVIEW_MODE=true while new
  // OTA JS ignores it — free user must stay locked.
  const freeOnOldNativeNewOta = buildEntitlementView(
    baseState({ planId: "free" }),
    start,
    { appReviewMode: true, serverAppReviewAccess: false },
  );
  assert.equal(freeOnOldNativeNewOta.isPro, false);
  assert.equal(freeOnOldNativeNewOta.statusLabel, "Free");
});

test("premium pages stay locked when APP_REVIEW_MODE=true without server flag", () => {
  const start = 1_700_000_000_000;
  const view = buildEntitlementView(baseState({ planId: "free" }), start, {
    email: "user@example.com",
    appReviewMode: true,
    appReviewAccountEmails: ["apple@stadiumedge.app"],
    serverAppReviewAccess: false,
  });
  assert.equal(view.isPro, false);
  assert.equal(softRequirePro(view.isPro), false);
  const features: PremiumFeatureId[] = [
    "edge_lock",
    "steals",
    "simulator",
    "model_report",
    "fantasy",
    "weather",
    "props",
    "notifications",
    "coach_ai_metrics",
  ];
  for (const id of features) {
    assert.equal(
      canAccessPremiumFeature(id, view.isPro),
      false,
      `${id} must stay locked under legacy APP_REVIEW_MODE`,
    );
  }
});

test("buildEntitlementView labels admin / free (promo unlock disabled)", () => {
  const start = 1_700_000_000_000;
  const admin = buildEntitlementView(baseState({ trialStartedAtMs: start }), start + 10 * DAY, {
    email: "admin@x.com",
    adminEmails: ["admin@x.com"], // ignored
    serverOwnerAccess: true,
  });
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.unlockSource, "admin");
  assert.equal(admin.statusLabel, "Admin");
  // Client admin allowlist alone → Free
  const forgedAdmin = buildEntitlementView(baseState({ planId: "free" }), start, {
    email: "danthony504@gmail.com",
    adminEmails: ["danthony504@gmail.com"],
  });
  assert.equal(forgedAdmin.isPro, false);
  assert.equal(forgedAdmin.statusLabel, "Free");

  const promo = buildEntitlementView(
    baseState({
      trialStartedAtMs: start,
      redeemedPromoCode: "KFXD4X2B",
      promoExpiresAtMs: start + 7 * DAY,
      promoLifetime: false,
    }),
    start + DAY,
    {},
  );
  assert.equal(promo.unlockSource, "none");
  assert.equal(promo.isPro, false);

  const legacyTrialStamp = buildEntitlementView(
    baseState({ planId: "free", trialStartedAtMs: start }),
    start + DAY,
    {},
  );
  assert.equal(legacyTrialStamp.unlockSource, "none");
  assert.equal(legacyTrialStamp.trialActive, false);
  assert.equal(legacyTrialStamp.statusLabel, "Free");

  const free = buildEntitlementView(baseState({ planId: "free" }), start + 10 * DAY, {});
  assert.equal(free.unlockSource, "none");
  assert.equal(free.isPro, false);
  assert.equal(free.statusLabel, "Free");
});

test("sanitizeSubscriptionState defaults storeKit fields", () => {
  const s = sanitizeSubscriptionState({
    planId: "free",
    trialStartedAtMs: null,
  });
  assert.equal(s.storeKitActive, false);
  assert.equal(s.storeKitProductId, null);
  assert.equal(s.storeKitManagementUrl, null);
});

test("clearLocalTrialEntitlement wipes legacy trial stamp", () => {
  const now = 1_700_000_000_000;
  const stamped = baseState({ trialStartedAtMs: now });
  assert.equal(stamped.trialStartedAtMs, now);
  const cleared = clearLocalTrialEntitlement(stamped);
  assert.equal(cleared.trialStartedAtMs, null);
  assert.equal(clearLocalTrialEntitlement(cleared).trialStartedAtMs, null);
});

test("clearUnverifiedPaidPlan drops local preview Go/Pro", () => {
  const local = baseState({ planId: "go", storeKitActive: false, storeKitProductId: "x" });
  const cleared = clearUnverifiedPaidPlan(local);
  assert.equal(cleared.planId, "free");
  assert.equal(cleared.storeKitProductId, null);
  const verified = baseState({
    planId: "pro",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.pro.monthly",
  });
  assert.equal(clearUnverifiedPaidPlan(verified).planId, "pro");
  assert.equal(clearUnverifiedPaidPlan(verified).storeKitActive, true);
  // Stored promo fields are cleared on hydrate via clearCustomPromoUnlock.
  const promo = baseState({
    planId: "free",
    redeemedPromoCode: "7VXHVPOR",
    promoLifetime: true,
  });
  assert.equal(clearUnverifiedPaidPlan(promo).redeemedPromoCode, "7VXHVPOR");
  const wiped = clearCustomPromoUnlock(promo);
  assert.equal(wiped.redeemedPromoCode, null);
  assert.equal(wiped.promoLifetime, false);
});

test("softRequirePro is a boolean soft gate", () => {
  assert.equal(softRequirePro(true), true);
  assert.equal(softRequirePro(false), false);
});

test("catalog shows Go/Pro price labels without claiming trial when StoreKit unavailable", () => {
  assert.equal(planById("free").paid, false);
  assert.equal(planById("go").priceLabel, "$9.99/week");
  assert.equal(planById("go").note, "Billed through Apple · $9.99/week");
  assert.equal(planById("pro").priceLabel, "$29.99/month");
  assert.equal(planById("pro").note, "Billed through Apple · $29.99/month");
  assert.equal(planById("go").paid, true);
  assert.equal(planById("pro").paid, true);
});

test("premium routes map to gated features; Coach stays free", () => {
  assert.equal(premiumFeatureForRoute("/arbitrage"), "edge_lock");
  assert.equal(premiumFeatureForRoute("/steals"), "steals");
  assert.equal(premiumFeatureForRoute("/simulator"), "simulator");
  assert.equal(premiumFeatureForRoute("/report"), "model_report");
  assert.equal(premiumFeatureForRoute("/fantasy"), "fantasy");
  assert.equal(premiumFeatureForRoute("/fantasy-lineup"), "fantasy");
  assert.equal(premiumFeatureForRoute("/weather"), "weather");
  assert.equal(premiumFeatureForRoute("/props"), "props");
  assert.equal(premiumFeatureForRoute("/notifications"), "notifications");
  assert.equal(premiumFeatureForRoute("/coach"), null);
  assert.equal(premiumFeatureForRoute("/"), null);
  assert.equal(premiumFeatureForRoute("/plans"), null);
  assert.equal(premiumFeatureForRoute("/account"), null);
  assert.equal(canAccessPremiumFeature("edge_lock", false), false);
  assert.equal(canAccessPremiumFeature("edge_lock", true), true);
  assert.equal(canAccessPremiumFeature("coach_ai_metrics", false), false);
  assert.equal(canAccessPremiumFeature("coach_ai_metrics", true), true);
});

test("custom promo redeem / deep-link unlock disabled (Guideline 3.1.1)", () => {
  const now = 1_700_000_000_000;
  assert.equal(CUSTOM_PROMO_UNLOCKS_ENABLED, false);
  // Catalog entries may still resolve for sanitize/debug — redeem must fail.
  assert.equal(findPromoDefinition("7vxhvpor")?.kind, "lifetime");
  assert.equal(redeemPromoCode(baseState(), "7VXHVPOR", now).ok, false);
  assert.equal(redeemPromoCode(baseState(), "KFXD4X2B", now).ok, false);
  assert.equal(redeemPromoCode(baseState(), "6EUSDWFI", 1_789_603_200_000).ok, false);
  assert.equal(buildPromoLink("KFXD4X2B", "stadium-edge.onrender.com"), null);
  assert.equal(extractPromoFromQuery({ promo: "kfxd4x2b" }), null);
  assert.equal(extractPromoFromQuery({ code: "7VXHVPOR" }), null);
});

test("admin email allowlist parsing", () => {
  assert.deepEqual(parseAdminEmails("a@x.com, b@y.com"), ["a@x.com", "b@y.com"]);
  assert.equal(isAdminEmail("A@X.com", ["a@x.com"]), true);
  assert.equal(isAdminEmail("other@x.com", ["a@x.com"]), false);
});

test("applyStoreKitSnapshot activates and clears Apple plans", () => {
  const start = baseState();
  const active = applyStoreKitSnapshot(start, {
    planId: "go",
    activeProductIds: ["com.stadiumedge.app.go.weekly"],
    managementUrl: "https://apps.apple.com/account/subscriptions",
  });
  assert.equal(active.planId, "go");
  assert.equal(active.storeKitActive, true);
  assert.equal(active.storeKitProductId, "com.stadiumedge.app.go.weekly");
  const cleared = applyStoreKitSnapshot(active, { planId: null, activeProductIds: [] });
  assert.equal(cleared.planId, "free");
  assert.equal(cleared.storeKitActive, false);
  assert.equal(cleared.storeKitProductId, null);
});
