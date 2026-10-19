import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_FREE_COACH_ASK, freeCoachAskForStyle, shouldAutoBuildFreeCoachPreview } from "./coachAutoFreePreview.ts";
import { createCoachSession } from "./coach/session.ts";
const base = { subscriptionHydrated: true, premiumUnlocked: false, messageCount: 1, busy: false, alreadyStartedOnFocus: false, pendingLaunch: false };
test("free or signed-out visitor starts exactly two-leg parlay when Coach is first opened", () => {
  assert.equal(shouldAutoBuildFreeCoachPreview(base), true);
  assert.match(AUTO_FREE_COACH_ASK, /2-leg parlay/);
});
test("never auto-build for subscriber, before hydration, during scan, or existing conversation", () => {
  for (const change of [{premiumUnlocked:true},{subscriptionHydrated:false},{busy:true},{messageCount:2},{alreadyStartedOnFocus:true},{pendingLaunch:true}]) {
    assert.equal(shouldAutoBuildFreeCoachPreview({...base,...change}),false,JSON.stringify(change));
  }
});

test("four Home tiles request distinct real-odds two-leg Coach builds", () => {
  const styles = ["hot", "easy", "value", "longshot"] as const;
  const asks = styles.map((s) => freeCoachAskForStyle(s));
  assert.equal(new Set(asks).size, 4);
  for (const ask of asks) {
    assert.match(ask, /2-leg parlay/);
    assert.match(ask, /real sportsbook odds/);
    assert.match(ask, /qualified simulated picks/);
  }
  assert.match(asks[1], /higher estimated hit probability/);
  assert.match(asks[2], /positive expected value/);
  assert.match(asks[3], /never add weak or unqualified legs/);
});

test("new Coach session has open outcome but should still auto-build when UI is not busy", () => {
  assert.equal(createCoachSession().outcome, "open");
  assert.equal(shouldAutoBuildFreeCoachPreview({...base, busy: false}), true);
});
