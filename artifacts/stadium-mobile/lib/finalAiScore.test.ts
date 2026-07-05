import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySimAlignment,
  buildFinalAiScore,
  combineFinalAiFactors,
  FINAL_AI_WEIGHTS,
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

test("FINAL_AI_WEIGHTS sum to 100%", () => {
  const sum = Object.values(FINAL_AI_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
  assert.equal(FINAL_AI_WEIGHTS.simulation, 0.3);
  assert.equal(FINAL_AI_WEIGHTS.lineValue, 0.2);
});

test("combineFinalAiFactors renormalizes when sharp/line-move feeds absent", () => {
  const composite = combineFinalAiFactors([
    { key: "simulation", label: "Simulation", score: 8 },
    { key: "lineValue", label: "Line Value", score: 8 },
    { key: "matchup", label: "Matchup", score: 8 },
    { key: "injury", label: "Injuries", score: 8 },
    { key: "trend", label: "Recent Form", score: 8 },
    { key: "sharpMoney", label: "Sharp Money", score: null },
    { key: "lineMovement", label: "Line Movement", score: null },
    { key: "lineShopping", label: "Line Shopping", score: 8 },
  ]);
  assert.equal(composite, 8);
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
      matchup: 8.5,
      trend: 8.5,
      lineValue: 8.5,
      injury: 8.5,
      lineShopping: 8.5,
      simulation: 8.5,
    },
    edgePct: 3.2,
    propSimHit: null,
    gameSim: {
      sport: "mlb",
      simulations: 10_000,
      homeWinProbability: 0.65,
      awayWinProbability: 0.35,
      tieProbability: 0,
      homeProjectedScore: 5,
      awayProjectedScore: 4,
      mostLikelyWinner: "home",
      mostLikelyWinnerPct: 0.65,
      confidenceScore: 60,
      coverHitRates: {
        "away team @ home team|moneyline|home team ml": 0.65,
      },
    },
  });
  assert.ok((score.composite ?? 0) >= 7.5, `expected B+ composite, got ${score.composite}`);
  assert.equal(score.recommends, true);
  assert.equal(score.highRiskValuePlay, false);
});
