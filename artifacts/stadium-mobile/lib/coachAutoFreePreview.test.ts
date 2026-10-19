import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_FREE_COACH_ASK, shouldAutoBuildFreeCoachPreview } from "./coachAutoFreePreview.ts";
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
