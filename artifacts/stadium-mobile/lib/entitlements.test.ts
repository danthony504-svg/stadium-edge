import assert from "node:assert/strict";
import test from "node:test";

import {
  TRIAL_LENGTH_DAYS,
  buildEntitlementView,
  buildPromoLink,
  canAccessPremiumFeature,
  ensureTrialStarted,
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

test("trialDaysRemaining counts whole days left", () => {
  const start = 1_700_000_000_000;
  assert.equal(trialDaysRemaining(null, start), 0);
  assert.equal(trialDaysRemaining(start, start), TRIAL_LENGTH_DAYS);
  assert.equal(trialDaysRemaining(start, start + 6 * DAY + 1), 1);
  assert.equal(trialDaysRemaining(start, start + 7 * DAY), 0);
  assert.equal(trialDaysRemaining(start, start + 10 * DAY), 0);
});

test("isTrialActive is true only inside the window", () => {
  const start = 1_700_000_000_000;
  assert.equal(isTrialActive(start, start + 3 * DAY), true);
  assert.equal(isTrialActive(start, start + 7 * DAY), false);
  assert.equal(isTrialActive(null, start), false);
});

test("hasProAccess: paid, trial, promo, and admin unlock", () => {
  const start = 1_700_000_000_000;
  assert.equal(
    hasProAccess(baseState({ planId: "go" }), start, {}),
    true,
  );
  assert.equal(
    hasProAccess(baseState({ planId: "free", trialStartedAtMs: start }), start + DAY, {}),
    true,
  );
  assert.equal(
    hasProAccess(baseState({ planId: "free", trialStartedAtMs: start }), start + 8 * DAY, {}),
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
    hasProAccess(baseState({ planId: "free", trialStartedAtMs: start }), start + 8 * DAY, {
      email: "owner@example.com",
      adminEmails: ["owner@example.com"],
    }),
    true,
  );
});

test("buildEntitlementView labels admin / promo / trial / free", () => {
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
      promoLifetime: false,
      promoExpiresAtMs: start + 20 * DAY,
    }),
    start + 10 * DAY,
  );
  assert.equal(promo.unlockSource, "promo");
  assert.equal(promo.isPro, true);

  const trial = buildEntitlementView(
    baseState({ planId: "free", trialStartedAtMs: start }),
    start + DAY,
  );
  assert.equal(trial.statusLabel, "Free trial");

  const expired = buildEntitlementView(
    baseState({ planId: "free", trialStartedAtMs: start }),
    start + 10 * DAY,
  );
  assert.equal(expired.isPro, false);
  assert.equal(expired.statusLabel, "Free");
  assert.match(expired.statusDetail, /Edge Lock/i);
});

test("sanitizeSubscriptionState rejects corrupt storage", () => {
  assert.deepEqual(sanitizeSubscriptionState(null), {
    planId: "free",
    trialStartedAtMs: null,
    redeemedPromoCode: null,
    promoExpiresAtMs: null,
    promoLifetime: false,
    promoRedeemCounts: {},
  });
  assert.equal(
    sanitizeSubscriptionState({ planId: "go", redeemedPromoCode: " kfxd4x2b " }).redeemedPromoCode,
    "KFXD4X2B",
  );
});

test("ensureTrialStarted stamps first launch only", () => {
  const now = 1_700_000_000_000;
  const first = ensureTrialStarted(baseState(), now);
  assert.equal(first.trialStartedAtMs, now);
  const again = ensureTrialStarted(first, now + DAY);
  assert.equal(again.trialStartedAtMs, now);
});

test("softRequirePro is a boolean soft gate", () => {
  assert.equal(softRequirePro(true), true);
  assert.equal(softRequirePro(false), false);
});

test("catalog prices match Free 7-day / Go $9.99 wk / Pro $29.99 mo", () => {
  assert.equal(planById("free").name, "Free trial");
  assert.equal(planById("free").periodLabel, "for 7 days");
  assert.equal(planById("go").priceLabel, "$9.99");
  assert.equal(planById("go").periodLabel, "a week");
  assert.equal(planById("pro").priceLabel, "$29.99");
  assert.equal(planById("pro").periodLabel, "per month");
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
  const vip = redeemPromoCode(baseState(), "7VXHVPOR", now);
  assert.equal(vip.ok, true);
  if (vip.ok) {
    assert.equal(vip.state.promoLifetime, true);
    assert.equal(isPromoUnlockActive(vip.state, now + 400 * DAY), true);
    assert.equal(vip.state.promoRedeemCounts["7VXHVPOR"], 1);
  }
  const week = redeemPromoCode(baseState(), "KFXD4X2B", now);
  assert.equal(week.ok, true);
  if (week.ok) {
    assert.equal(week.state.promoLifetime, false);
    assert.equal(week.state.promoExpiresAtMs, now + 7 * DAY);
    assert.equal(isPromoUnlockActive(week.state, now + 3 * DAY), true);
    assert.equal(isPromoUnlockActive(week.state, now + 8 * DAY), false);
  }
  assert.equal(redeemPromoCode(baseState(), "NOPE", now).ok, false);
});

test("promo redeem window and fixed unlock-until date", () => {
  const flashOpen = 1_789_700_000_000; // inside Sep 17 – Oct 17 2026
  const flashClosed = 1_792_300_000_000; // after Oct 17 2026
  const flashEarly = 1_789_500_000_000; // before Sep 17 2026

  const early = redeemPromoCode(baseState(), "6EUSDWFI", flashEarly);
  assert.equal(early.ok, false);
  if (!early.ok) assert.equal(early.reason, "not_yet");

  const mid = redeemPromoCode(baseState(), "6EUSDWFI", flashOpen);
  assert.equal(mid.ok, true);

  const closed = redeemPromoCode(baseState(), "6EUSDWFI", flashClosed);
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.reason, "redeem_expired");

  const season = redeemPromoCode(baseState(), "8VZV43WK", flashOpen);
  assert.equal(season.ok, true);
  if (season.ok) {
    assert.equal(season.state.promoExpiresAtMs, 1_798_761_600_000);
    assert.equal(isPromoUnlockActive(season.state, 1_798_761_600_000), false);
  }

  // Per-device limit: after flash expires, cannot redeem again.
  if (mid.ok) {
    const expiredState = {
      ...mid.state,
      promoExpiresAtMs: flashOpen - DAY,
      promoLifetime: false,
    };
    const again = redeemPromoCode(expiredState, "6EUSDWFI", flashOpen);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.reason, "limit_reached");
  }
});

test("admin email allowlist parsing", () => {
  assert.deepEqual(parseAdminEmails("A@X.com, b@y.com"), ["a@x.com", "b@y.com"]);
  assert.equal(isAdminEmail("A@X.com", ["a@x.com"]), true);
  assert.equal(isAdminEmail("other@x.com", ["a@x.com"]), false);
  assert.equal(isAdminEmail(null, ["a@x.com"]), false);
});

test("promo link + query extract", () => {
  assert.equal(
    buildPromoLink("KFXD4X2B", "stadium-edge.onrender.com"),
    "https://stadium-edge.onrender.com/plans?promo=KFXD4X2B",
  );
  assert.equal(buildPromoLink("NOPE", "stadium-edge.onrender.com"), null);
  assert.equal(extractPromoFromQuery({ promo: "kk48izsn" }), "KK48IZSN");
  assert.equal(extractPromoFromQuery({ code: ["8VZV43WK"] }), "8VZV43WK");
  assert.equal(extractPromoFromQuery({}), null);
});
