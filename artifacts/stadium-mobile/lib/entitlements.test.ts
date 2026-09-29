import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLE_INTRO_TRIAL_DAYS,
  buildEntitlementView,
  buildPromoLink,
  canAccessPremiumFeature,
  clearLocalTrialEntitlement,
  extractPromoFromQuery,
  findPromoDefinition,
  hasProAccess,
  isAdminEmail,
  isPlanId,
  isPromoUnlockActive,
  isTrialActive,
  parseAdminEmails,
  planById,
  premiumFeatureForRoute,
  redeemPromoCode,
  sanitizeSubscriptionState,
  softRequirePro,
  trialDaysRemaining,
  applyStoreKitSnapshot,
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

test("hasProAccess: paid, promo, and admin unlock — not local trial", () => {
  const start = 1_700_000_000_000;
  assert.equal(hasProAccess(baseState({ planId: "go" }), start, {}), true);
  assert.equal(
    hasProAccess(baseState({ planId: "free", trialStartedAtMs: start }), start + DAY, {}),
    false,
  );
  assert.equal(
    hasProAccess(
      baseState({
        redeemedPromoCode: "7VXHVPOR",
        promoLifetime: true,
      }),
      start + 100 * DAY,
      {},
    ),
    true,
  );
  assert.equal(
    hasProAccess(baseState({ planId: "free" }), start, {
      email: "owner@example.com",
      adminEmails: ["owner@example.com"],
    }),
    true,
  );
});

test("buildEntitlementView labels admin / promo / free (no local trial)", () => {
  const start = 1_700_000_000_000;
  const admin = buildEntitlementView(baseState({ trialStartedAtMs: start }), start + 10 * DAY, {
    email: "admin@x.com",
    adminEmails: ["admin@x.com"],
  });
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.unlockSource, "admin");
  assert.equal(admin.statusLabel, "Admin");

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
  assert.equal(promo.unlockSource, "promo");
  assert.equal(promo.isPro, true);

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

test("softRequirePro is a boolean soft gate", () => {
  assert.equal(softRequirePro(true), true);
  assert.equal(softRequirePro(false), false);
});

test("catalog shows Go/Pro with intro trial copy (no free-trial plan card)", () => {
  assert.equal(planById("free").paid, false);
  assert.equal(planById("go").priceLabel, "$9.99/week");
  assert.equal(planById("go").note, "7-day free trial, then $9.99/week");
  assert.equal(planById("pro").priceLabel, "$29.99/month");
  assert.equal(planById("pro").note, "7-day free trial, then $29.99/month");
  assert.equal(planById("go").paid, true);
  assert.equal(planById("pro").paid, true);
});

test("premium routes map to gated features; Coach stays free", () => {
  assert.equal(premiumFeatureForRoute("/arbitrage"), "edge_lock");
  assert.equal(premiumFeatureForRoute("/steals"), "steals");
  assert.equal(premiumFeatureForRoute("/simulator"), "simulator");
  assert.equal(premiumFeatureForRoute("/report"), "model_report");
  assert.equal(premiumFeatureForRoute("/coach"), null);
  assert.equal(premiumFeatureForRoute("/"), null);
  assert.equal(premiumFeatureForRoute("/props"), null);
  assert.equal(canAccessPremiumFeature("edge_lock", false), false);
  assert.equal(canAccessPremiumFeature("edge_lock", true), true);
  assert.equal(canAccessPremiumFeature("coach_ai_metrics", false), false);
  assert.equal(canAccessPremiumFeature("coach_ai_metrics", true), true);
});

test("promo catalog redeem lifetime and timed codes", () => {
  const now = 1_700_000_000_000;
  assert.equal(findPromoDefinition("7vxhvpor")?.kind, "lifetime");
  const life = redeemPromoCode(baseState(), "7VXHVPOR", now);
  assert.equal(life.ok, true);
  if (life.ok) {
    assert.equal(life.state.promoLifetime, true);
    assert.equal(isPromoUnlockActive(life.state, now + 1000 * DAY), true);
  }
  const week = redeemPromoCode(baseState(), "KFXD4X2B", now);
  assert.equal(week.ok, true);
  if (week.ok) {
    assert.equal(week.state.promoLifetime, false);
    assert.ok((week.state.promoExpiresAtMs ?? 0) > now);
  }
});

test("promo redeem window and fixed unlock-until date", () => {
  const now = 1_789_603_200_000; // inside flash window
  const flash = redeemPromoCode(baseState(), "6EUSDWFI", now);
  assert.equal(flash.ok, true);
  const tooLate = redeemPromoCode(baseState(), "6EUSDWFI", 1_792_281_600_000);
  assert.equal(tooLate.ok, false);
});

test("admin email allowlist parsing", () => {
  assert.deepEqual(parseAdminEmails("a@x.com, b@y.com"), ["a@x.com", "b@y.com"]);
  assert.equal(isAdminEmail("A@X.com", ["a@x.com"]), true);
  assert.equal(isAdminEmail("other@x.com", ["a@x.com"]), false);
});

test("promo link + query extract", () => {
  const link = buildPromoLink("KFXD4X2B", "stadium-edge.onrender.com");
  assert.ok(link?.includes("promo=KFXD4X2B"));
  assert.equal(extractPromoFromQuery({ promo: "kfxd4x2b" }), "KFXD4X2B");
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
