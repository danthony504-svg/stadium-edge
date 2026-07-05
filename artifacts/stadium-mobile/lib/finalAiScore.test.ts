import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySimAlignment,
  buildFinalAiScore,
  HIGH_RISK_EDGE_MIN,
} from "./finalAiScore.ts";

test("classifySimAlignment: aligned at 52%+", () => {
  const r = classifySimAlignment(0.55, 2);
  assert.equal(r.simAligned, true);
  assert.equal(r.highRiskValuePlay, false);
});

test("classifySimAlignment: high-risk when sim low but edge huge", () => {
  const r = classifySimAlignment(0.41, HIGH_RISK_EDGE_MIN + 1);
  assert.equal(r.simAligned, false);
  assert.equal(r.highRiskValuePlay, true);
});

test("classifySimAlignment: drop zone when sim low and edge small", () => {
  const r = classifySimAlignment(0.41, 2);
  assert.equal(r.simAligned, false);
  assert.equal(r.highRiskValuePlay, false);
});

test("buildFinalAiScore recommends sim-aligned B+ leg", () => {
  const score = buildFinalAiScore({
    pick: {
      game: "Away Team @ Home Team",
      market: "Moneyline",
      pick: "Home Team ML",
      odds: -110,
      isProp: false,
    },
    rubricScores: {
      matchup: 8,
      trend: 8,
      lineValue: 8,
      injury: 7.5,
      lineShopping: 7.5,
      simulation: 8,
    },
    edgePct: 3.2,
    propSimHit: null,
    gameSim: {
      sport: "mlb",
      simulations: 10_000,
      homeWinProbability: 0.58,
      awayWinProbability: 0.42,
      tieProbability: 0,
      homeProjectedScore: 5,
      awayProjectedScore: 4,
      mostLikelyWinner: "home",
      mostLikelyWinnerPct: 0.58,
      confidenceScore: 60,
      coverHitRates: {
        "away team @ home team|moneyline|home team ml": 0.58,
      },
    },
  });
  assert.equal(score.recommends, true);
  assert.equal(score.highRiskValuePlay, false);
});
