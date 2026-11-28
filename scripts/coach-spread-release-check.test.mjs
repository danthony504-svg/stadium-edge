import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSpreadRelease } from "./coach-spread-release-check.mjs";

const cohort = (size, offset, modelProbability, wins, closingFairProbability = 0.6) =>
  Array.from({ length: size }, (_, i) => ({
    eventId: String(i + offset), modelProbability, price: -110,
    closingFairProbability, closeMatches: true, edgeQualified: true,
    result: i < wins ? "win" : "loss",
  }));

test("balanced aggregate cannot hide a failing probability band", () => {
  const rows = [...cohort(250, 0, 0.61, 135), ...cohort(250, 250, 0.71, 195)];
  const result = evaluateSpreadRelease({ rows, enabledBands: [6, 7], draws: 1000 });
  assert.equal(result.overall.calibrationPass, true);
  assert.ok(Math.abs(result.worstBand.gap) > 0.05);
  assert.equal(result.release, false);
});

test("calibrated picks need positive closing-line value and positive realized return", () => {
  const rows = cohort(500, 0, 0.7, 350);
  const assess = selected => evaluateSpreadRelease({ rows: selected, enabledBands: [7], draws: 1000 });
  assert.equal(assess(rows).release, true);
  const lostEdge = assess(rows.map(row => ({ ...row, closingFairProbability: 0.5 })));
  assert.equal(lostEdge.overall.calibrationPass, true);
  assert.equal(lostEdge.overall.edgePass, false);
  assert.equal(lostEdge.release, false);
  assert.equal(assess(rows.map(row => ({ ...row, closeMatches: false }))).overall.missingClosingQuote, 500);
});
