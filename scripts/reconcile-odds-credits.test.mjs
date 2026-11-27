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
