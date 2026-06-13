import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseMlCushionTiers,
  ML_CUSHION_MIN_PTS,
  ML_CUSHION_MAX_PTS,
  ML_CUSHION_MIN_ODDS,
} from "./mlCushion.ts";

test("empty rungs -> null (card shows BEST only)", () => {
  assert.equal(chooseMlCushionTiers([]), null);
});

test("single rung -> Safe only, no Value", () => {
  const r = chooseMlCushionTiers([{ line: 4.5, odds: -200 }]);
  assert.deepEqual(r, { safe: 0, value: null });
});

test("favorite: deepest cushion is Safe (lowest odds), shallowest is Value (best payout)", () => {
  // More points = more juice (lower odds). +6.5 -320 (safest), +1.5 -150 (best payout).
  const rungs = [
    { line: 1.5, odds: -150 },
    { line: 6.5, odds: -320 },
    { line: 3.5, odds: -230 },
  ];
  const r = chooseMlCushionTiers(rungs);
  assert.ok(r);
  assert.equal(rungs[r!.safe].line, 6.5); // safest = most points / lowest odds
  assert.equal(rungs[r!.value!].line, 1.5); // value = highest payout
});

test("Value is chosen by PAYOUT, not by smallest line (mispriced/stale rung)", () => {
  // Shallowest line (+1.5) is NOT the best payout here; +3.5 is stale-juiced UP.
  const rungs = [
    { line: 1.5, odds: -180 },
    { line: 3.5, odds: -120 }, // best payout despite being a deeper cushion
    { line: 7.5, odds: -400 },
  ];
  const r = chooseMlCushionTiers(rungs);
  assert.ok(r);
  assert.equal(rungs[r!.safe].line, 7.5); // lowest odds
  assert.equal(rungs[r!.value!].odds, -120); // highest odds wins, not smallest line
});

test("underdog: plus-money cushion rungs still pick lowest/highest odds", () => {
  const rungs = [
    { line: 1.5, odds: 120 }, // less cushion, highest payout
    { line: 8.5, odds: -160 }, // most cushion, lowest payout = safest
  ];
  const r = chooseMlCushionTiers(rungs);
  assert.ok(r);
  assert.equal(rungs[r!.safe].line, 8.5);
  assert.equal(rungs[r!.value!].line, 1.5);
});

test("equal odds tie-break -> deeper cushion (more points) wins for both tiers", () => {
  const rungs = [
    { line: 2.5, odds: -150 },
    { line: 5.5, odds: -150 },
  ];
  const r = chooseMlCushionTiers(rungs);
  assert.ok(r);
  // Same price: Safe AND Value both prefer more points, so they collapse to the
  // deeper rung and Value is dropped (no duplicate chip).
  assert.equal(rungs[r!.safe].line, 5.5);
  assert.equal(r!.value, null);
});

test("deterministic: same Safe/Value rung regardless of input order", () => {
  const ascending = [
    { line: 1.5, odds: -150 },
    { line: 6.5, odds: -320 },
  ];
  const descending = [
    { line: 6.5, odds: -320 },
    { line: 1.5, odds: -150 },
  ];
  const a = chooseMlCushionTiers(ascending)!;
  const b = chooseMlCushionTiers(descending)!;
  assert.equal(ascending[a.safe].odds, -320);
  assert.equal(descending[b.safe].odds, -320);
  assert.equal(ascending[a.value!].odds, -150);
  assert.equal(descending[b.value!].odds, -150);
});

test("plus-money cushions: Safe = lowest plus odds, Value = highest payout", () => {
  // After PickCard's plus-money filter (odds >= +100), tiers still resolve by
  // odds: +110 is the safest plus price, +175 the best payout.
  const rungs = [
    { line: 1.5, odds: 110 },
    { line: 1, odds: 175 },
    { line: 2.5, odds: 130 },
  ];
  const r = chooseMlCushionTiers(rungs)!;
  assert.equal(rungs[r.safe].odds, 110);
  assert.equal(rungs[r.value!].odds, 175);
});

test("band constants are +1..+20 and plus-money floor is +100", () => {
  assert.equal(ML_CUSHION_MIN_PTS, 1);
  assert.equal(ML_CUSHION_MAX_PTS, 20);
  assert.equal(ML_CUSHION_MIN_ODDS, 100);
});
