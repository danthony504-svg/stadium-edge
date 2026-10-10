import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeSubscriptionState } from "./entitlements.ts";
import {
  COACH_PREMIUM_FEATURE_LABEL,
  PREMIUM_VALUE_MASK,
  hasCoachPremiumAccess,
  hasVerifiedCoachEntitlement,
  hasVerifiedStoreKitPaidPlan,
  isCoachPremiumLocked,
  publicCoachPickSummary,
  redactPremiumBoardScanPicks,
  redactPremiumPickFields,
} from "./coachPremiumGate.ts";

const NOW = 1_700_000_000_000;

function state(over: Record<string, unknown> = {}) {
  return sanitizeSubscriptionState({ planId: "free", ...over });
}

test("CTA label is Unlock AI Picks", () => {
  assert.equal(COACH_PREMIUM_FEATURE_LABEL, "Unlock AI Picks");
});

test("logged out: premium locked even with local Go planId", () => {
  const go = state({ planId: "go", storeKitActive: true });
  assert.equal(hasCoachPremiumAccess(go, NOW, { signedIn: false }), false);
  assert.equal(isCoachPremiumLocked(go, NOW, { signedIn: false, hydrated: true }), true);
});

test("logged in without StoreKit: premium locked", () => {
  const free = state({ planId: "free" });
  assert.equal(hasCoachPremiumAccess(free, NOW, { signedIn: true }), false);
  // Local/preview Go without storeKitActive must not unlock.
  const preview = state({ planId: "go", storeKitActive: false });
  assert.equal(hasCoachPremiumAccess(preview, NOW, { signedIn: true }), false);
});

test("logged in with active Go entitlement: unlocked", () => {
  const go = state({
    planId: "go",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.go.weekly",
  });
  assert.equal(hasVerifiedStoreKitPaidPlan(go), true);
  assert.equal(hasCoachPremiumAccess(go, NOW, { signedIn: true }), true);
  assert.equal(isCoachPremiumLocked(go, NOW, { signedIn: true, hydrated: true }), false);
});

test("logged in with active Pro entitlement: unlocked", () => {
  const pro = state({
    planId: "pro",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.pro.monthly",
  });
  assert.equal(hasCoachPremiumAccess(pro, NOW, { signedIn: true }), true);
});

test("expired / cleared StoreKit: access removed", () => {
  const expired = state({ planId: "free", storeKitActive: false });
  assert.equal(hasCoachPremiumAccess(expired, NOW, { signedIn: true }), false);
  assert.equal(hasVerifiedStoreKitPaidPlan(expired), false);
});

test("APP_REVIEW_MODE does not unlock Coach premium via verified helpers", () => {
  const free = state({ planId: "free" });
  // Review mode is intentionally not an argument — verified helpers ignore it.
  assert.equal(
    hasVerifiedCoachEntitlement(free, NOW, { appReviewMode: true }),
    false,
  );
  assert.equal(
    hasCoachPremiumAccess(free, NOW, { signedIn: true, appReviewMode: true }),
    false,
  );
});

test("admin allowlist unlocks when signed in", () => {
  const free = state({ planId: "free" });
  assert.equal(
    hasCoachPremiumAccess(free, NOW, {
      signedIn: true,
      email: "owner@example.com",
      adminEmails: ["owner@example.com"],
    }),
    true,
  );
  assert.equal(
    hasCoachPremiumAccess(free, NOW, {
      signedIn: false,
      email: "owner@example.com",
      adminEmails: ["owner@example.com"],
    }),
    false,
  );
});

test("not hydrated → locked", () => {
  const go = state({ planId: "go", storeKitActive: true });
  assert.equal(
    isCoachPremiumLocked(go, NOW, { signedIn: true, hydrated: false }),
    true,
  );
});

test("restore path: StoreKit snapshot fields grant access after verification", () => {
  // Mimic restore applying an active Go snapshot onto free state.
  const restored = state({
    planId: "go",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.go.weekly",
  });
  assert.equal(hasCoachPremiumAccess(restored, NOW, { signedIn: true }), true);
});

test("public summary keeps player / market; redaction strips premium fields", () => {
  const summary = publicCoachPickSummary({
    game: "Lakers @ Celtics",
    market: "Player Points",
    player: "LeBron James",
    isProp: true,
  });
  assert.equal(summary.title, "LeBron James");
  assert.equal(summary.subtitle, "Player Points");

  const redacted = redactPremiumPickFields({
    game: "Lakers @ Celtics",
    market: "Player Points",
    pick: "LeBron James Over 24.5",
    odds: -110,
    edge: "Model +4.2% edge vs -110",
    player: "LeBron James",
    propLine: 24.5,
    propSide: "Over",
    scores: { composite: 8.1, grade: "A", confidencePct: 62, edgePct: 4.2 },
    finalAiScore: { grade: "A", composite: 8.1, simHit: 0.58 },
    liveCoach: {
      score: "98-95",
      period: 4,
      clock: "2:10",
      line: 24.5,
      price: -110,
      edgePct: 4.2,
      confidencePct: 62,
    },
  });
  assert.equal(redacted.pick, PREMIUM_VALUE_MASK);
  assert.equal(redacted.odds, 0);
  assert.equal(redacted.edge, undefined);
  assert.equal(redacted.propLine, null);
  assert.equal(redacted.propSide, undefined);
  assert.equal(redacted.scores, undefined);
  assert.equal(redacted.finalAiScore, undefined);
  assert.equal(redacted.player, "LeBron James");
  assert.equal(redacted.game, "Lakers @ Celtics");
  assert.equal(redacted.liveCoach?.score, "98-95");
  assert.equal(redacted.liveCoach?.line, null);
  assert.equal(redacted.liveCoach?.edgePct, 0);

  const scan = redactPremiumBoardScanPicks({
    picks: [
      {
        game: "A @ B",
        market: "Spread",
        pick: "A -3.5",
        odds: -105,
        edge: "edge note",
      },
    ],
  });
  assert.equal(scan?.picks?.[0]?.pick, PREMIUM_VALUE_MASK);
  assert.equal(scan?.picks?.[0]?.odds, 0);
  assert.equal(scan?.picks?.[0]?.game, "A @ B");
});

test("redacted pick string does not contain original side/line/odds text", () => {
  const original = "Chiefs -3.5";
  const redacted = redactPremiumPickFields({
    game: "Chiefs @ Bills",
    market: "Spread",
    pick: original,
    odds: -108,
  });
  assert.notEqual(redacted.pick, original);
  assert.ok(!String(redacted.pick).includes("-3.5"));
  assert.ok(!String(redacted.pick).includes("Chiefs -"));
});
