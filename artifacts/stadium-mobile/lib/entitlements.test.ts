import assert from "node:assert/strict";
import test from "node:test";

import {
  TRIAL_LENGTH_DAYS,
  buildEntitlementView,
  ensureTrialStarted,
  hasProAccess,
  isPlanId,
  isTrialActive,
  planById,
  sanitizeSubscriptionState,
  softRequirePro,
  trialDaysRemaining,
} from "./entitlements.ts";

const DAY = 24 * 60 * 60 * 1000;

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

test("hasProAccess: paid plans always unlock; free needs trial", () => {
  const start = 1_700_000_000_000;
  assert.equal(hasProAccess("go", null, start), true);
  assert.equal(hasProAccess("pro", null, start), true);
  assert.equal(hasProAccess("free", start, start + DAY), true);
  assert.equal(hasProAccess("free", start, start + 8 * DAY), false);
  assert.equal(hasProAccess("free", null, start), false);
});

test("buildEntitlementView labels trial vs free vs paid", () => {
  const start = 1_700_000_000_000;
  const trial = buildEntitlementView(
    { planId: "free", trialStartedAtMs: start },
    start + DAY,
  );
  assert.equal(trial.isPro, true);
  assert.equal(trial.statusLabel, "Free trial");
  assert.match(trial.statusDetail, /days left/i);

  const expired = buildEntitlementView(
    { planId: "free", trialStartedAtMs: start },
    start + 10 * DAY,
  );
  assert.equal(expired.isPro, false);
  assert.equal(expired.statusLabel, "Free");

  const pro = buildEntitlementView(
    { planId: "pro", trialStartedAtMs: start },
    start + 10 * DAY,
  );
  assert.equal(pro.isPro, true);
  assert.equal(pro.plan.name, "Stadium Edge Pro");
});

test("sanitizeSubscriptionState rejects corrupt storage", () => {
  assert.deepEqual(sanitizeSubscriptionState(null), {
    planId: "free",
    trialStartedAtMs: null,
  });
  assert.deepEqual(sanitizeSubscriptionState({ planId: "hack", trialStartedAtMs: "x" }), {
    planId: "free",
    trialStartedAtMs: null,
  });
  assert.deepEqual(
    sanitizeSubscriptionState({ planId: "go", trialStartedAtMs: 42 }),
    { planId: "go", trialStartedAtMs: 42 },
  );
});

test("ensureTrialStarted stamps first launch only", () => {
  const now = 1_700_000_000_000;
  const first = ensureTrialStarted({ planId: "free", trialStartedAtMs: null }, now);
  assert.equal(first.trialStartedAtMs, now);
  const again = ensureTrialStarted(first, now + DAY);
  assert.equal(again.trialStartedAtMs, now);
});

test("softRequirePro is a boolean soft gate", () => {
  assert.equal(softRequirePro(true), true);
  assert.equal(softRequirePro(false), false);
});

test("planById falls back safely", () => {
  assert.equal(planById("go").id, "go");
  assert.equal(planById("free").paid, false);
  assert.equal(planById("pro").paid, true);
});

test("catalog prices match Free 7-day / Go $9.99 wk / Pro $29.99 mo", () => {
  assert.equal(planById("free").name, "Free trial");
  assert.equal(planById("free").periodLabel, "for 7 days");
  assert.equal(planById("go").priceLabel, "$9.99");
  assert.equal(planById("go").periodLabel, "a week");
  assert.equal(planById("pro").priceLabel, "$29.99");
  assert.equal(planById("pro").periodLabel, "per month");
});
