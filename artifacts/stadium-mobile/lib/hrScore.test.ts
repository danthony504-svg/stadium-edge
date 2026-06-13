import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHrScore, hrScoreBand, type HrFactorKey } from "./hrScore.ts";

const factor = (s: ReturnType<typeof computeHrScore>, key: HrFactorKey) =>
  s.factors.find((f) => f.key === key)!;

test("all 7 factors present: score is a blend in 0..100 with full weight", () => {
  const s = computeHrScore({
    hrPer9: 1.3, // mid-high
    barrelPctAllowed: 8,
    hardHitPctAllowed: 39,
    battedBallEvents: 120,
    flyBallPct: 0.4,
    hrIndex: 102,
    tempF: 70,
    dome: false,
    platoonOps: 0.825,
  });
  assert.equal(s.presentCount, 7);
  assert.deepEqual(s.excluded, []);
  assert.ok(s.score != null && s.score >= 0 && s.score <= 100);
  // Weight shares of present factors sum to 100.
  const shareSum = s.factors.reduce((a, f) => a + (f.weightShare ?? 0), 0);
  assert.ok(Math.abs(shareSum - 100) < 1e-6);
  // hr9 keeps its full 25% share when every factor is present.
  assert.ok(Math.abs(factor(s, "hr9").weightShare! - 25) < 1e-6);
});

test("maximum favorability inputs => score 100", () => {
  const s = computeHrScore({
    hrPer9: 2.5,
    barrelPctAllowed: 15,
    hardHitPctAllowed: 55,
    battedBallEvents: 200,
    flyBallPct: 0.6,
    hrIndex: 130,
    tempF: 100,
    dome: false,
    platoonOps: 1.2,
  });
  assert.equal(s.score, 100);
});

test("minimum favorability inputs => score 0", () => {
  const s = computeHrScore({
    hrPer9: 0.3,
    barrelPctAllowed: 2,
    hardHitPctAllowed: 25,
    battedBallEvents: 200,
    flyBallPct: 0.2,
    hrIndex: 80,
    tempF: 35,
    dome: false,
    platoonOps: 0.5,
  });
  assert.equal(s.score, 0);
});

test("missing factors are excluded and weights renormalize", () => {
  // Only HR/9 (25) and Park (10) present -> shares 71.4% / 28.6%.
  const s = computeHrScore({
    hrPer9: 1.3,
    hrIndex: 102,
  });
  assert.equal(s.presentCount, 2);
  assert.equal(s.excluded.length, 5);
  const shareSum = s.factors.reduce((a, f) => a + (f.weightShare ?? 0), 0);
  assert.ok(Math.abs(shareSum - 100) < 1e-6);
  assert.ok(Math.abs(factor(s, "hr9").weightShare! - (25 / 35) * 100) < 1e-6);
  assert.ok(Math.abs(factor(s, "park").weightShare! - (10 / 35) * 100) < 1e-6);
  // Excluded factors carry null sub/contribution (never guessed).
  assert.equal(factor(s, "barrel").sub, null);
  assert.equal(factor(s, "barrel").contribution, null);
});

test("Statcast below the sample threshold is excluded, not trusted", () => {
  const s = computeHrScore({
    barrelPctAllowed: 14, // would be very HR-favorable...
    hardHitPctAllowed: 50,
    battedBallEvents: 10, // ...but tiny sample -> excluded
  });
  assert.equal(factor(s, "barrel").sub, null);
  assert.equal(factor(s, "hardhit").sub, null);
  assert.equal(s.excluded.includes("barrel"), true);
  assert.equal(s.excluded.includes("hardhit"), true);
});

test("Statcast at/above the threshold IS counted", () => {
  const s = computeHrScore({ barrelPctAllowed: 8, battedBallEvents: 40 });
  assert.equal(factor(s, "barrel").sub != null, true);
  assert.equal(factor(s, "barrel").display, "8.0% barrels");
});

test("Statcast with UNKNOWN sample (null bbe) is excluded, never assumed", () => {
  // A barrel/hard-hit rate with no confirmed sample size must NOT count — we
  // can't verify it's meaningful, so honesty requires excluding it.
  const s = computeHrScore({
    barrelPctAllowed: 10,
    hardHitPctAllowed: 45,
    battedBallEvents: null,
  });
  assert.equal(factor(s, "barrel").sub, null);
  assert.equal(factor(s, "hardhit").sub, null);
  assert.equal(s.excluded.includes("barrel"), true);
  assert.equal(s.excluded.includes("hardhit"), true);
});

test("dome counts as a present, weather-neutral factor", () => {
  const s = computeHrScore({ hrPer9: 1.3, dome: true });
  const w = factor(s, "weather");
  assert.equal(w.sub, 0.5);
  assert.equal(w.display, "Dome (neutral)");
  assert.equal(s.excluded.includes("weather"), false);
});

test("outdoor with no temperature excludes weather (never guessed)", () => {
  const s = computeHrScore({ hrPer9: 1.3, dome: false, tempF: null });
  assert.equal(factor(s, "weather").sub, null);
  assert.equal(s.excluded.includes("weather"), true);
});

test("no usable inputs => null score", () => {
  const s = computeHrScore({});
  assert.equal(s.score, null);
  assert.equal(s.presentCount, 0);
  assert.equal(s.excluded.length, 7);
});

test("displays format real values, leading zero dropped on OPS", () => {
  const s = computeHrScore({ platoonOps: 0.812, hrPer9: 1.42, flyBallPct: 0.45 });
  assert.equal(factor(s, "platoon").display, ".812 OPS vs hand");
  assert.equal(factor(s, "hr9").display, "1.42 HR/9");
  assert.equal(factor(s, "flyball").display, "45% fly balls");
});

test("hrScoreBand thresholds", () => {
  assert.equal(hrScoreBand(75).tone, "hot");
  assert.equal(hrScoreBand(60).tone, "warm");
  assert.equal(hrScoreBand(45).tone, "neutral");
  assert.equal(hrScoreBand(20).tone, "cold");
});
