import assert from "node:assert/strict";
import test from "node:test";
import { reconcileOddsCredits } from "./reconcile-odds-credits.mjs";

test("reconciles known and unattributed production credits and excludes test keys", () => {
  const start = { at: "2026-11-25T00:00:00Z", used: 1000 };
  const end = { at: "2026-11-28T00:00:00Z", used: 2000 };
  const row = { at: "2026-11-26T00:00:00Z", keyTier: "production" };
  const result = reconcileOddsCredits({ start, end, rows: [
    { ...row, caller: "scheduled_refresh", cost: 600 },
    { ...row, cost: 100 },
    { ...row, cost: null },
    { ...row, keyTier: "test", cost: 300 },
    { ...row, at: start.at, cost: 700 },
  ] });
  assert.deepEqual(result.byCaller, { unattributed: 100, scheduled_refresh: 600 });
  assert.equal(result.missingCost, 1);
  assert.equal(result.unattributedGap, 300);
  assert.equal(result.requiresReview, true);
});


test("a late reset baseline exposes the missing interval even with zero measured gap", () => {
  const windowStartAt = "2026-12-01T00:00:00Z";
  const start = { at: "2026-12-01T00:07:00Z", used: 700 };
  const end = { at: "2026-12-02T00:00:00Z", used: 10700 };
  const result = reconcileOddsCredits({ windowStartAt, start, end, rows: [
    { at: end.at, keyTier: "production", caller: "coach_build", cost: 10000 },
  ] });
  assert.equal(result.gap, 0);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.requiresReview, true);
  assert.deepEqual(result.uncoveredInterval, { start: windowStartAt, end: start.at });
});

test("late-month threshold uses the spend in the window and flags only above it", () => {
  const start = { at: "2026-11-28T00:00:00Z", used: 4800000 };
  const end = { at: "2026-11-29T00:00:00Z", used: 4810000 };
  for (const [cost, expected] of [[9501, false], [9500, false], [9499, true]]) {
    const result = reconcileOddsCredits({ start, end, rows: [{ at: end.at, keyTier: "production", cost }] });
    assert.equal(result.threshold, 500);
    assert.equal(result.requiresReview, expected);
  }
});
