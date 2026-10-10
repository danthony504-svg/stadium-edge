import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeSubscriptionState } from "./entitlements.ts";
import {
  COACH_PREMIUM_FEATURE_LABEL,
  COACH_QA_SIGN_IN_MESSAGE,
  COACH_QA_SUBSCRIBE_MESSAGE,
  PREMIUM_VALUE_MASK,
  hasCoachPremiumAccess,
  hasVerifiedCoachEntitlement,
  hasVerifiedStoreKitPaidPlan,
  isCoachPremiumLocked,
  publicCoachPickSummary,
  redactPremiumBoardScanPicks,
  redactPremiumPickFields,
  resolveCoachAskAccess,
} from "./coachPremiumGate.ts";

const NOW = 1_700_000_000_000;

function state(over: Record<string, unknown> = {}) {
  return sanitizeSubscriptionState({ planId: "free", ...over });
}

test("CTA label mentions Sign In / Subscribe to Reveal Picks", () => {
  assert.match(COACH_PREMIUM_FEATURE_LABEL, /Reveal Picks/i);
});

test("logged out: premium locked even with local Go planId", () => {
  const go = state({ planId: "go", storeKitActive: true });
  assert.equal(hasCoachPremiumAccess(go, NOW, { signedIn: false }), false);
  assert.equal(isCoachPremiumLocked(go, NOW, { signedIn: false, hydrated: true }), true);
});

test("logged in without StoreKit: premium locked", () => {
  const free = state({ planId: "free" });
  assert.equal(hasCoachPremiumAccess(free, NOW, { signedIn: true }), false);
  const preview = state({ planId: "go", storeKitActive: false });
  assert.equal(hasCoachPremiumAccess(preview, NOW, { signedIn: true }), false);
});

test("logged in with active Go/Pro: unlocked", () => {
  const go = state({
    planId: "go",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.go.weekly",
  });
  assert.equal(hasVerifiedStoreKitPaidPlan(go), true);
  assert.equal(hasCoachPremiumAccess(go, NOW, { signedIn: true }), true);
  const pro = state({
    planId: "pro",
    storeKitActive: true,
    storeKitProductId: "com.stadiumedge.app.pro.monthly",
  });
  assert.equal(hasCoachPremiumAccess(pro, NOW, { signedIn: true }), true);
});

test("APP_REVIEW_MODE does not unlock Coach premium via verified helpers", () => {
  const free = state({ planId: "free" });
  assert.equal(
    hasVerifiedCoachEntitlement(free, NOW, { appReviewMode: true }),
    false,
  );
  assert.equal(
    hasCoachPremiumAccess(free, NOW, { signedIn: true, appReviewMode: true }),
    false,
  );
});

test("designated App Review account can unlock Coach; other emails cannot", () => {
  const free = state({ planId: "free" });
  assert.equal(
    hasCoachPremiumAccess(free, NOW, {
      signedIn: true,
      email: "apple@stadiumedge.app",
      appReviewAccountEmails: ["apple@stadiumedge.app"],
      appReviewMode: true,
    }),
    true,
  );
  assert.equal(
    hasCoachPremiumAccess(free, NOW, {
      signedIn: true,
      email: "fan@example.com",
      appReviewAccountEmails: ["apple@stadiumedge.app"],
      appReviewMode: true,
    }),
    false,
  );
});

test("parlay asks allowed for everyone; general questions gated", () => {
  for (const ask of ["1 leg MLB", "2 leg parlay", "5 leg NFL parlay", "9 leg", "15 leg parlay"]) {
    assert.deepEqual(
      resolveCoachAskAccess({
        askText: ask,
        isParlayBuild: true,
        signedIn: false,
        premiumUnlocked: false,
      }),
      { allowed: true },
      ask,
    );
  }
  assert.deepEqual(
    resolveCoachAskAccess({
      askText: "5 leg NFL parlay",
      isParlayBuild: true,
      signedIn: false,
      premiumUnlocked: false,
    }),
    { allowed: true },
  );
  assert.deepEqual(
    resolveCoachAskAccess({
      askText: "Who wins tonight?",
      isParlayBuild: false,
      signedIn: false,
      premiumUnlocked: false,
    }),
    { allowed: false, reason: "sign_in", message: COACH_QA_SIGN_IN_MESSAGE },
  );
  assert.deepEqual(
    resolveCoachAskAccess({
      askText: "Who wins tonight?",
      isParlayBuild: false,
      signedIn: true,
      premiumUnlocked: false,
    }),
    { allowed: false, reason: "subscribe", message: COACH_QA_SUBSCRIBE_MESSAGE },
  );
  assert.deepEqual(
    resolveCoachAskAccess({
      askText: "Who wins tonight?",
      isParlayBuild: false,
      signedIn: true,
      premiumUnlocked: true,
    }),
    { allowed: true },
  );
});

test("redaction keeps grades; strips identity, lines, odds, times", () => {
  const summary = publicCoachPickSummary({
    game: "Lakers @ Celtics",
    market: "Player Points",
    player: "LeBron James",
    sport: "nba",
    isProp: true,
  });
  assert.equal(summary.title, "NBA · Player Points");
  assert.ok(!summary.title.includes("LeBron"));

  const redacted = redactPremiumPickFields({
    game: "Lakers @ Celtics",
    market: "Player Points",
    pick: "LeBron James Over 24.5",
    odds: -110,
    edge: "Model +4.2% edge vs -110",
    player: "LeBron James",
    startsAt: "2026-10-10T00:00:00Z",
    propLine: 24.5,
    propSide: "Over",
    scores: { composite: 8.1, grade: "A", confidencePct: 62, edgePct: 4.2 },
    finalAiScore: { grade: "A", composite: 8.1, simHit: 0.58, confidencePct: 62, edgePct: 4.2 },
  });
  assert.equal(redacted.pick, PREMIUM_VALUE_MASK);
  assert.equal(redacted.game, PREMIUM_VALUE_MASK);
  assert.equal(redacted.odds, 0);
  assert.equal(redacted.player, undefined);
  assert.equal(redacted.startsAt, null);
  assert.equal(redacted.propLine, null);
  assert.equal(redacted.finalAiScore?.grade, "A");
  assert.equal(redacted.finalAiScore?.confidencePct, 62);
  assert.equal(redacted.finalAiScore?.edgePct, 4.2);
  assert.equal(redacted.scores?.composite, 8.1);
  assert.equal((redacted as { propMarketKey?: string }).propMarketKey, undefined);

  const scan = redactPremiumBoardScanPicks({
    picks: [
      {
        game: "A @ B",
        market: "Spread",
        pick: "A -3.5",
        odds: -105,
        finalAiScore: { grade: "B+", confidencePct: 55, edgePct: 2.1 },
      },
    ],
  });
  assert.equal(scan?.picks?.[0]?.game, PREMIUM_VALUE_MASK);
  assert.equal(scan?.picks?.[0]?.finalAiScore?.grade, "B+");
});
