import assert from "node:assert/strict";
import test from "node:test";
import type { CombinedPickScore } from "./pickScore.ts";
import {
  isRecommendableProp,
  isVisibleByDefault,
  meetsSimulatorQualityThreshold,
  primaryPickReason,
  topSimulatorPickReasons,
} from "./simulatorRecommendations.ts";

function combined(partial: Partial<CombinedPickScore> & { scores?: CombinedPickScore["scores"] }): CombinedPickScore {
  return {
    scores: {
      matchup: null,
      trend: null,
      lineValue: null,
      injury: null,
      lineShopping: null,
      simulation: null,
      ...(partial.scores ?? {}),
    },
    composite: partial.composite ?? null,
    grade: partial.grade ?? null,
    confidencePct: partial.confidencePct ?? null,
    edgePct: partial.edgePct ?? null,
  };
}

const simRow = {
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
  confidenceScore: 62,
  stdDev: null,
  sampleGames: 8,
  percentiles: null,
};

test("isVisibleByDefault hides D/F and negative edge", () => {
  assert.equal(isVisibleByDefault(combined({ grade: "C", edgePct: 1.2 })), true);
  assert.equal(isVisibleByDefault(combined({ grade: "D", edgePct: 2 })), false);
  assert.equal(isVisibleByDefault(combined({ grade: "B", edgePct: -1 })), false);
});

test("meetsSimulatorQualityThreshold requires grade B+ recommendable props", () => {
  assert.equal(
    meetsSimulatorQualityThreshold(combined({ grade: "B", edgePct: 2.1 }), simRow),
    true,
  );
  assert.equal(
    meetsSimulatorQualityThreshold(combined({ grade: "C+", edgePct: 2.1 }), simRow),
    false,
  );
});

test("isRecommendableProp rejects incomplete Monte Carlo and low hit rate", () => {
  assert.equal(isRecommendableProp(combined({ grade: "B", edgePct: 2 }), simRow), true);
  assert.equal(isRecommendableProp(combined({ grade: "B", edgePct: 0 }), simRow), false);
  assert.equal(
    isRecommendableProp(combined({ grade: "B", edgePct: 2 }), { ...simRow, hitProbability: 0.4 }),
    false,
  );
  assert.equal(
    isRecommendableProp(combined({ grade: "B", edgePct: 2 }), { ...simRow, completedSims: 500 }),
    false,
  );
});

test("topSimulatorPickReasons uses short labels", () => {
  const reasons = topSimulatorPickReasons(
    combined({
      edgePct: 3.2,
      scores: {
        matchup: 7.8,
        trend: 6.8,
        lineValue: 8.1,
        injury: null,
        lineShopping: 7.2,
        simulation: 7.2,
      },
    }),
    simRow,
    3,
  );
  assert.ok(reasons.includes("Strong matchup") || reasons.includes("Positive line value"));
  assert.equal(primaryPickReason(combined({ scores: { matchup: 8, trend: null, lineValue: null, injury: null, lineShopping: null, simulation: null } }), simRow), "Strong matchup");
});
