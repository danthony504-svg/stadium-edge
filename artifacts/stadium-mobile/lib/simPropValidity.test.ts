import assert from "node:assert/strict";
import test from "node:test";

import type { CombinedPickScore } from "./pickScore.ts";
import {
  capGradeForSimHit,
  isDeepMonteCarloComplete,
  isSimProjectionConsistent,
  isValidPropSimData,
  resolveDisplayEdge,
} from "./simPropValidity.ts";

const baseSimRow = {
  key: "x",
  player: "A",
  market: "batter_hits",
  line: 1.5,
  side: "Over" as const,
  requestedSims: 10_000,
  completedSims: 10_000,
  failedSims: 0,
  actualSimCount: 10_000,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  runTimeMs: 1000,
  simulations: 10_000,
  hitProbability: 0.58,
  mostLikelyLine: 2,
  meanProjection: 1.8,
  medianProjection: 2,
  confidenceScore: 72,
  stdDev: 0.4,
  sampleGames: 8,
  percentiles: null,
};

function combined(partial: Partial<CombinedPickScore>): CombinedPickScore {
  return {
    scores: {
      matchup: 7,
      trend: 7,
      lineValue: 8,
      injury: null,
      lineShopping: null,
      simulation: 7,
      ...(partial.scores ?? {}),
    },
    composite: partial.composite ?? 8.2,
    grade: partial.grade ?? "A-",
    confidencePct: partial.confidencePct ?? 70,
    edgePct: partial.edgePct ?? 3.2,
  };
}

test("isDeepMonteCarloComplete requires 10,000 successful draws", () => {
  assert.equal(isDeepMonteCarloComplete(baseSimRow), true);
  assert.equal(isDeepMonteCarloComplete({ ...baseSimRow, completedSims: 1000 }), false);
  assert.equal(isDeepMonteCarloComplete({ ...baseSimRow, failedSims: 1 }), false);
});

test("isSimProjectionConsistent rejects contradictory hit vs projection", () => {
  assert.equal(isSimProjectionConsistent(baseSimRow), true);
  assert.equal(
    isSimProjectionConsistent({ ...baseSimRow, meanProjection: 0.5, hitProbability: 0.7 }),
    false,
  );
});

test("isValidPropSimData requires hit, confidence, projection, and consistency", () => {
  assert.equal(isValidPropSimData(baseSimRow), true);
  assert.equal(isValidPropSimData({ ...baseSimRow, meanProjection: null }), false);
  assert.equal(isValidPropSimData({ ...baseSimRow, hitProbability: null }), false);
});

test("capGradeForSimHit limits high grades on very low sim hit", () => {
  const high = combined({ grade: "A-", composite: 8.2 });
  const capped = capGradeForSimHit(high, { ...baseSimRow, hitProbability: 0.15 });
  assert.ok(capped.grade && ["D", "F", "C-", "C", "C+", "B-", "B"].includes(capped.grade));
  assert.notEqual(capped.grade, "A-");
});

test("resolveDisplayEdge uses betting edge or derives from sim hit", () => {
  assert.equal(resolveDisplayEdge(combined({ edgePct: 2.5 }), baseSimRow), 2.5);
  const derived = resolveDisplayEdge(combined({ edgePct: null }), baseSimRow, -110);
  assert.ok(derived != null && derived > 0);
});
