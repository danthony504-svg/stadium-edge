import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLockedPreviewSafe,
  COACH_LOCKED_PARLAY_CTA,
  type LockedOpenParlayPreview,
} from "../src/lib/coachLockedPreviewSafety.ts";
import { redactPremiumPickForClient } from "../src/lib/coachSlateTypes.ts";
import { parseRevenueCatSubscriberPayload } from "../src/lib/revenueCatSubscriber.ts";

test("assertLockedPreviewSafe rejects identity-bearing picks", () => {
  const bad: LockedOpenParlayPreview = {
    content: "ok",
    pickCount: 1,
    requestedLegs: 5,
    cta: COACH_LOCKED_PARLAY_CTA,
    picks: [
      {
        game: "Lakers @ Celtics",
        market: "Spread",
        pick: "Lakers -3.5",
        odds: -110,
      },
    ],
  };
  const leaks = assertLockedPreviewSafe(bad);
  assert.ok(leaks.includes("pick[0].game"));
  assert.ok(leaks.includes("pick[0].pick"));
  assert.ok(leaks.includes("pick[0].odds"));
});

test("assertLockedPreviewSafe accepts redacted picks with grades", () => {
  const redacted = redactPremiumPickForClient({
    game: "Lakers @ Celtics",
    market: "Spread",
    pick: "Lakers -3.5",
    odds: -110,
    startsAt: "2026-10-10T00:00:00Z",
    finalAiScore: { grade: "A", composite: 8, confidencePct: 60, edgePct: 3 },
  });
  const good: LockedOpenParlayPreview = {
    content: "5 qualifying picks ready. Sign in / subscribe to reveal picks.",
    pickCount: 1,
    requestedLegs: 5,
    cta: COACH_LOCKED_PARLAY_CTA,
    picks: [redacted],
  };
  assert.deepEqual(assertLockedPreviewSafe(good), []);
  assert.equal(redacted.finalAiScore?.grade, "A");
  assert.equal(redacted.finalAiScore?.confidencePct, 60);
});

test("assertLockedPreviewSafe rejects PICK: lines in content", () => {
  const bad: LockedOpenParlayPreview = {
    content: "PICK: Lakers @ Celtics | Spread | Lakers -3.5 | -110",
    pickCount: 0,
    requestedLegs: 5,
    cta: COACH_LOCKED_PARLAY_CTA,
    picks: [],
  };
  assert.ok(assertLockedPreviewSafe(bad).includes("content.PICK"));
});

test("parseRevenueCatSubscriberPayload grants active go/pro from RC entitlements", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const go = parseRevenueCatSubscriberPayload({
    subscriber: {
      entitlements: {
        go: {
          expires_date: future,
          product_identifier: "com.stadiumedge.app.go.weekly",
        },
      },
      subscriptions: {
        "com.stadiumedge.app.go.weekly": { expires_date: future },
      },
      management_url: "https://apps.apple.com/account/subscriptions",
    },
  });
  assert.equal(go.ok, true);
  if (go.ok) {
    assert.equal(go.planId, "go");
    assert.equal(go.storeKitActive, true);
  }
});

test("parseRevenueCatSubscriberPayload fail-closed on expired entitlement", () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const out = parseRevenueCatSubscriberPayload({
    subscriber: {
      entitlements: {
        pro: {
          expires_date: past,
          product_identifier: "com.stadiumedge.app.pro.monthly",
        },
      },
      subscriptions: {},
    },
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, "inactive");
});

test("parseRevenueCatSubscriberPayload ignores client-shaped forged fields", () => {
  const out = parseRevenueCatSubscriberPayload({
    subscriber: { entitlements: {}, subscriptions: {} },
    planId: "pro",
    storeKitActive: true,
  });
  assert.equal(out.ok, false);
});
