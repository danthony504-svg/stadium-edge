import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildProjectionMean,
  runMonteCarloSimulation,
  simulationKey,
  type PropSimulationContext,
} from "../src/lib/monteCarlo.ts";

test("buildProjectionMean weights recent form and pace", () => {
  const ctx: PropSimulationContext = {
    sport: "nba",
    market: "player_points",
    line: 24.5,
    side: "Over",
    recentValues: [28, 26, 30, 22, 27, 25, 29, 24, 26, 28],
    oppPace: 104,
    leaguePace: 100,
    minutesL5: 36,
    minutesSeason: 32,
    discrete: false,
  };
  const mean = buildProjectionMean(ctx);
  assert.ok(mean != null && mean > 24);
});

test("runMonteCarloSimulation returns hit probability and mode line", () => {
  const ctx: PropSimulationContext = {
    sport: "nba",
    market: "player_points",
    line: 20.5,
    side: "Over",
    recentValues: [32, 30, 28, 31, 29, 27, 30, 28, 31, 29],
    discrete: false,
  };
  const result = runMonteCarloSimulation(ctx, 5000);
  assert.equal(result.simulations, 5000);
  assert.ok(result.hitProbability != null && result.hitProbability > 0.7);
  assert.ok(result.mostLikelyLine != null && result.mostLikelyLine >= 20);
  assert.ok(result.confidenceScore != null && result.confidenceScore >= 55);
  assert.ok(result.percentiles != null);
});

test("runMonteCarloSimulation fails closed with thin sample", () => {
  const result = runMonteCarloSimulation({
    sport: "nba",
    market: "player_points",
    line: 10.5,
    side: "Over",
    recentValues: [12, 11],
  });
  assert.equal(result.hitProbability, null);
  assert.equal(result.simulations, 0);
});

test("simulationKey is stable", () => {
  assert.equal(
    simulationKey("LeBron James", "player_points", 24.5, "Over"),
    "LeBron James|player_points|24.5|Over",
  );
});
