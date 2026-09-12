import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipScannerPropExpand } from "./propPoolPolicy.ts";
import {
  coachAbsoluteBudgetMs,
  coachPropLoadFailsafeMs,
  createCoachSession,
  resetCoachAbsoluteClock,
} from "./session.ts";

test("skip scanner prop expand only when pool is already loaded", () => {
  assert.equal(shouldSkipScannerPropExpand(0), false);
  assert.equal(shouldSkipScannerPropExpand(39), false);
  assert.equal(shouldSkipScannerPropExpand(40), true);
  assert.equal(shouldSkipScannerPropExpand(400), true);
});

test("fixed-leg scoring budgets leave room for prop/alt scoring after game lines", () => {
  assert.equal(coachAbsoluteBudgetMs(5), 65_000);
  assert.equal(coachAbsoluteBudgetMs(6), 70_000);
  assert.ok(coachAbsoluteBudgetMs(6) > 45_000);
});

test("prop-board load failsafe is independent of scoring budget", () => {
  assert.equal(coachPropLoadFailsafeMs(), 75_000);
  assert.ok(coachPropLoadFailsafeMs() >= coachAbsoluteBudgetMs(6));
});

test("resetCoachAbsoluteClock restarts scoring window after prop prefetch", () => {
  const session = createCoachSession(1, 6, 1_000);
  resetCoachAbsoluteClock(session, 50_000);
  assert.equal(session.startedAtMs, 50_000);
  assert.equal(session.absoluteTimer, null);
  assert.equal(session.outcome, "open");
});

/**
 * Preview staging reserves ~50% of a fixed-leg ticket for props. On a 5-leg
 * ask that is exactly 2 game lines — the screenshot failure mode when the
 * empty propPool never scored and the reserved preview latched as final.
 */
test("5-leg reserved prop slots leave exactly 2 game-line preview capacity", () => {
  const target = 5;
  const propSlots = Math.max(1, Math.round(target * 0.5));
  const nonPropCap = Math.max(0, target - propSlots);
  assert.equal(propSlots, 3);
  assert.equal(nonPropCap, 2);
});


test("7-leg reserved prop slots leave exactly 3 game-line preview capacity", () => {
  const target = 7;
  const propSlots = Math.max(1, Math.round(target * 0.5));
  const nonPropCap = Math.max(0, target - propSlots);
  assert.equal(propSlots, 4);
  assert.equal(nonPropCap, 3);
});
