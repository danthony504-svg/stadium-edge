import assert from "node:assert/strict";
import { test } from "node:test";

import { runGameMonteCarlo } from "../src/lib/gameMonteCarlo.ts";
import {
  DEEP_SIMULATIONS,
  runMonteCarloSimulation,
  type PropSimulationContext,
} from "../src/lib/monteCarlo.ts";

const propCtx: PropSimulationContext = {
  sport: "nba",
  market: "player_points",
  line: 20.5,
  side: "Over",
  recentValues: [32, 30, 28, 31, 29, 27, 30, 28, 31, 29],
  discrete: false,
};

test("runMonteCarloSimulation completes exactly 10,000 draws", () => {
  const result = runMonteCarloSimulation(propCtx, DEEP_SIMULATIONS);
  assert.equal(result.requestedSims, DEEP_SIMULATIONS);
  assert.equal(result.completedSims, DEEP_SIMULATIONS);
  assert.equal(result.actualSimCount, DEEP_SIMULATIONS);
  assert.equal(result.failedSims, 0);
  assert.equal(result.simulations, DEEP_SIMULATIONS);
});

test("runGameMonteCarlo completes exactly 10,000 game simulations", () => {
  const result = runGameMonteCarlo({
    sport: "mlb",
    simulations: DEEP_SIMULATIONS,
    home: { ptsFor: 5.2, ptsAgainst: 4.1, recentScores: [5, 6, 4, 5, 7] },
    away: { ptsFor: 4.8, ptsAgainst: 4.5, recentScores: [4, 5, 3, 5, 6] },
  });
  assert.ok(result);
  assert.equal(result!.requestedSims, DEEP_SIMULATIONS);
  assert.equal(result!.completedSims, DEEP_SIMULATIONS);
  assert.equal(result!.actualSimCount, DEEP_SIMULATIONS);
  assert.equal(result!.failedSims, 0);
  assert.equal(result!.simulations, DEEP_SIMULATIONS);
});
