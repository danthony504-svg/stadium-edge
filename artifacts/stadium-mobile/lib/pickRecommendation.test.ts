import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_AI_RECOMMENDED,
  pickGradeDisplayLabel,
  pickIsAiRecommended,
} from "./pickRecommendation.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { NOT_YET_AI_GRADED } from "./simMarketSupport.ts";

test("pickIsAiRecommended requires sim grade and positive thresholds", () => {
  const score = {
    composite: 8,
    grade: "A",
    confidencePct: 65,
    edgePct: 4,
    simHit: 0.58,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { composite: 8, grade: "A", confidencePct: 65, edgePct: 4, scores: {} as never },
  };
  assert.equal(pickIsAiRecommended({ market: "Spread", sport: "nba", odds: -110 }, score), true);
});

test("pickGradeDisplayLabel shows Not AI Recommended when sim exists but thresholds fail", () => {
  const score = buildFinalAiScore({
    pick: {
      game: "A @ B",
      market: "Spread",
      pick: "B -3.5",
      odds: -110,
      isProp: false,
      sport: "nba",
    },
    rubricScores: {
      matchup: 5,
      trend: 5,
      lineValue: 5,
      injury: 5,
      lineShopping: 5,
      simulation: 5,
    },
    edgePct: -1,
    gameSim: {
      sport: "nba",
      simulations: 10_000,
      homeWinProbability: 0.48,
      awayWinProbability: 0.52,
      tieProbability: 0,
      homeProjectedScore: 108,
      awayProjectedScore: 109,
      mostLikelyWinner: "away",
      mostLikelyWinnerPct: 0.52,
      confidenceScore: 50,
      coverHitRates: { "a @ b|spread|b -3.5": 0.49 },
    },
  });
  assert.equal(
    pickGradeDisplayLabel({ market: "Spread", sport: "nba", odds: -110 }, score),
    NOT_AI_RECOMMENDED,
  );
});

test("unsupported market uses not-yet-graded path via pickHasSimGrade", () => {
  assert.equal(
    pickGradeDisplayLabel({ market: "Both Teams To Score", sport: "soccer" }, null),
    null,
  );
});
