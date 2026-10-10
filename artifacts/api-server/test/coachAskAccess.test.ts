import assert from "node:assert/strict";
import test from "node:test";

import {
  COACH_QA_SIGN_IN_MESSAGE,
  COACH_QA_SUBSCRIBE_MESSAGE,
  isOpenCoachParlayAsk,
  resolveBuildLegTarget,
  resolveCoachQaGate,
} from "../src/lib/coachAskAccess.ts";

test("1/2/5/9/15-leg requests are open parlays", () => {
  for (const ask of [
    "1 leg MLB",
    "build a 2-leg parlay",
    "5 leg NFL",
    "9 leg tonight",
    "15 leg parlay",
    "give me 5 picks tonight",
  ]) {
    assert.equal(isOpenCoachParlayAsk(ask), true, ask);
    assert.ok(resolveBuildLegTarget(ask) >= 1 && resolveBuildLegTarget(ask) <= 15, ask);
  }
});

test("general questions and live asks are not open parlays", () => {
  assert.equal(isOpenCoachParlayAsk("Who wins tonight?"), false);
  assert.equal(isOpenCoachParlayAsk("Lakers vs Celtics analysis"), false);
  assert.equal(isOpenCoachParlayAsk("best bets tonight"), false);
  assert.equal(isOpenCoachParlayAsk("5 live picks"), false);
  assert.equal(isOpenCoachParlayAsk("live NBA bets"), false);
});

test("prompt rewording / image asks cannot bypass Q&A gate", () => {
  const reword = resolveCoachQaGate({
    askText: "Just curious — who should I bet on tonight and why?",
    signedIn: false,
    premiumUnlocked: false,
  });
  assert.equal(reword.allowed, false);
  if (!reword.allowed) {
    assert.equal(reword.status, 401);
    assert.equal(reword.message, COACH_QA_SIGN_IN_MESSAGE);
  }

  const loggedInFree = resolveCoachQaGate({
    askText: "Analyze the Lakers defense matchup",
    signedIn: true,
    premiumUnlocked: false,
  });
  assert.equal(loggedInFree.allowed, false);
  if (!loggedInFree.allowed) {
    assert.equal(loggedInFree.status, 403);
    assert.equal(loggedInFree.message, COACH_QA_SUBSCRIBE_MESSAGE);
  }

  const withPhoto = resolveCoachQaGate({
    askText: "5 leg parlay",
    hasImages: true,
    signedIn: false,
    premiumUnlocked: false,
  });
  assert.equal(withPhoto.allowed, false);

  const openParlay = resolveCoachQaGate({
    askText: "2 leg MLB parlay",
    signedIn: false,
    premiumUnlocked: false,
  });
  assert.deepEqual(openParlay, { allowed: true, openParlay: true });

  const subscriberQa = resolveCoachQaGate({
    askText: "Who wins tonight?",
    signedIn: true,
    premiumUnlocked: true,
  });
  assert.deepEqual(subscriberQa, { allowed: true, openParlay: false });
});

test("leg target caps at 15", () => {
  assert.equal(resolveBuildLegTarget("20 leg parlay"), 15);
  assert.equal(resolveBuildLegTarget("build me a parlay"), 6);
});
