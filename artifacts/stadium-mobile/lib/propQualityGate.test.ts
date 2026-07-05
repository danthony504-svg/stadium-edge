import assert from "node:assert/strict";
import test from "node:test";
import {
  PROP_QUALITY_MAX_SOFT_FAILURES,
  PROP_QUALITY_MIN_GRADE,
  evaluatePropQuality,
} from "./propQualityGate.ts";
import type { CombinedPickScore } from "./pickScore.ts";

function mockScores(overrides: Partial<CombinedPickScore["scores"]> & {
  composite?: number;
  confidencePct?: number;
  edgePct?: number;
}): CombinedPickScore {
  return {
    scores: {
      matchup: 6.5,
      trend: 6.5,
      lineValue: 7,
      injury: null,
      lineShopping: null,
      simulation: 7,
      ...overrides,
    },
    composite: overrides.composite ?? 8,
    grade: "A-",
    confidencePct: overrides.confidencePct ?? 62,
    edgePct: overrides.edgePct ?? 3.2,
  };
}

test("evaluatePropQuality: passes when sim ok and at most two soft checks fail", () => {
  const scores = mockScores({ matchup: 5.0, trend: 5.0 }); // two soft fails
  const r = evaluatePropQuality(scores, 0.58);
  assert.equal(r.passes, true);
  assert.equal(r.softFailureCount, 2);
});

test("evaluatePropQuality: fails without simulation", () => {
  const scores = mockScores();
  const r = evaluatePropQuality(scores, null);
  assert.equal(r.passes, false);
  assert.equal(r.checks.simulation, false);
});

test("evaluatePropQuality: fails when three+ soft checks fail even with sim", () => {
  const scores = mockScores({
    composite: 4,
    confidencePct: 45,
    edgePct: -1,
    matchup: 4,
    trend: 4,
  });
  const r = evaluatePropQuality(scores, 0.42);
  assert.equal(r.passes, false);
  assert.ok(r.softFailureCount > PROP_QUALITY_MAX_SOFT_FAILURES);
});

test("evaluatePropQuality: Duran-like cold SB prop fails (D grade, no edge, cold form)", () => {
  const scores = mockScores({
    composite: 4,
    confidencePct: 49,
    edgePct: null,
    trend: 3.5,
    matchup: 5.5,
  });
  const r = evaluatePropQuality(scores, 0.12);
  assert.equal(r.passes, false);
  assert.ok(scores.composite! < PROP_QUALITY_MIN_GRADE);
});
