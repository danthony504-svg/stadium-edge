import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseMlCushionTwoBand,
  ML_CUSHION_MIN_PTS,
  ML_CUSHION_MAX_PTS,
  ML_CUSHION_MIN_ODDS,
} from "./mlCushion.ts";

const FLOOR = -550;

test("empty rungs -> neither tier (card shows BEST only)", () => {
  assert.deepEqual(chooseMlCushionTwoBand([], FLOOR), { safe: null, value: null });
});

test("only a minus-money rung -> Safe only, no Value", () => {
  const r = chooseMlCushionTwoBand([{ line: 2.5, odds: -200 }], FLOOR);
  assert.deepEqual(r, { safe: 0, value: null });
});

test("only a plus-money rung -> Value only, no Safe", () => {
  const r = chooseMlCushionTwoBand([{ line: 1.5, odds: 130 }], FLOOR);
  assert.deepEqual(r, { safe: null, value: 0 });
});

test("both bands present: Safe = deepest minus rung, Value = highest-payout plus rung", () => {
  const rungs = [
    { line: 1.5, odds: 120 }, // plus -> value candidate
    { line: 1, odds: 175 }, // plus, best payout -> Value
    { line: 2.5, odds: -180 }, // minus -> safe candidate
    { line: 3.5, odds: -260 }, // minus, deepest -> Safe
  ];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  assert.equal(rungs[r.safe!].line, 3.5); // most points among minus rungs
  assert.equal(rungs[r.value!].odds, 175); // best payout among plus rungs
});

test("Value is chosen by PAYOUT, not by smallest line (mispriced/stale plus rung)", () => {
  // Shallowest plus line (+1.5) is NOT the best payout; +3.5 is stale-juiced UP.
  const rungs = [
    { line: 1.5, odds: 105 },
    { line: 3.5, odds: 160 }, // deeper cushion AND best payout
  ];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  assert.equal(rungs[r.value!].odds, 160);
  assert.equal(r.safe, null);
});

test("Safe is the DEEPEST minus rung even if a shallower one is cheaper", () => {
  const rungs = [
    { line: 2.5, odds: -120 }, // cheaper but shallower
    { line: 5.5, odds: -300 }, // deepest -> Safe
  ];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  assert.equal(rungs[r.safe!].line, 5.5);
});

test("Safe tie on line -> less-negative odds wins", () => {
  const rungs = [
    { line: 4.5, odds: -260 },
    { line: 4.5, odds: -190 }, // same points, better price -> Safe
  ];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  assert.equal(rungs[r.safe!].odds, -190);
});

test("Value tie on odds -> deeper cushion (more points) wins", () => {
  const rungs = [
    { line: 1.5, odds: 140 },
    { line: 3.5, odds: 140 }, // same price, more points -> Value
  ];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  assert.equal(rungs[r.value!].line, 3.5);
});

test("buried no-payout juice past the floor is excluded from Safe", () => {
  const rungs = [
    { line: 8.5, odds: -900 }, // past floor -> ignored
    { line: 3.5, odds: -300 }, // deepest within floor -> Safe
  ];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  assert.equal(rungs[r.safe!].line, 3.5);
});

test("even-money (-100..+99) counts as Safe band, not Value", () => {
  const rungs = [{ line: 2.5, odds: -105 }, { line: 1.5, odds: 90 }];
  const r = chooseMlCushionTwoBand(rungs, FLOOR);
  // +90 is below the +100 plus-money floor -> Safe band; deeper -105 is deeper.
  assert.equal(rungs[r.safe!].line, 2.5);
  assert.equal(r.value, null);
});

test("deterministic: same Safe/Value regardless of input order", () => {
  const ascending = [
    { line: 1.5, odds: 150 },
    { line: 6.5, odds: -320 },
  ];
  const descending = [
    { line: 6.5, odds: -320 },
    { line: 1.5, odds: 150 },
  ];
  const a = chooseMlCushionTwoBand(ascending, FLOOR);
  const b = chooseMlCushionTwoBand(descending, FLOOR);
  assert.equal(ascending[a.safe!].odds, -320);
  assert.equal(descending[b.safe!].odds, -320);
  assert.equal(ascending[a.value!].odds, 150);
  assert.equal(descending[b.value!].odds, 150);
});

test("band constants are +1..+20 and plus-money floor is +100", () => {
  assert.equal(ML_CUSHION_MIN_PTS, 1);
  assert.equal(ML_CUSHION_MAX_PTS, 20);
  assert.equal(ML_CUSHION_MIN_ODDS, 100);
});
