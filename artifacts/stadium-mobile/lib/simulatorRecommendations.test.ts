import assert from "node:assert/strict";
import test from "node:test";
import type { CombinedPickScore } from "./pickScore.ts";
import {
  meetsSimulatorQualityThreshold,
  simulatorRecommendation,
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

test("meetsSimulatorQualityThreshold requires grade B or higher and positive edge", () => {
  assert.equal(
    meetsSimulatorQualityThreshold(combined({ grade: "B", edgePct: 2.1, composite: 7.2 })),
    true,
  );
  assert.equal(
    meetsSimulatorQualityThreshold(combined({ grade: "B-", edgePct: 2.1, composite: 6.6 })),
    false,
  );
  assert.equal(
    meetsSimulatorQualityThreshold(combined({ grade: "B", edgePct: 0, composite: 7.2 })),
    false,
  );
});

test("simulatorRecommendation returns Play for quality threshold picks", () => {
  const rec = simulatorRecommendation(
    combined({ grade: "B", edgePct: 1.5, composite: 7.1 }),
    {
      key: "x",
      player: "A",
      market: "batter_hits",
      line: 1.5,
      side: "Over",
      simulations: 1000,
      hitProbability: 0.58,
      mostLikelyLine: 2,
      meanProjection: 1.8,
      medianProjection: 2,
      confidenceScore: 62,
      stdDev: null,
      sampleGames: 8,
      percentiles: null,
    },
  );
  assert.equal(rec, "Play");
});

test("topSimulatorPickReasons returns strongest factors first", () => {
  const reasons = topSimulatorPickReasons(
    combined({
      edgePct: 3.2,
      scores: {
        matchup: 7.8,
        trend: 6.8,
        lineValue: 8.1,
        injury: null,
        lineShopping: null,
        simulation: 7.2,
      },
    }),
    {
      key: "x",
      player: "A",
      market: "batter_hits",
      line: 1.5,
      side: "Over",
      simulations: 1000,
      hitProbability: 0.61,
      mostLikelyLine: 2,
      meanProjection: 1.8,
      medianProjection: 2,
      confidenceScore: 62,
      stdDev: null,
      sampleGames: 8,
      percentiles: null,
    },
    3,
  );
  assert.ok(reasons.length >= 2);
  assert.ok(reasons.some((r) => r.includes("edge")));
});
