import assert from "node:assert/strict";
import { test } from "node:test";

import { runGameMonteCarlo } from "../src/lib/gameMonteCarlo.ts";

test("runGameMonteCarlo returns win probabilities and projected scores", () => {
  const result = runGameMonteCarlo({
    sport: "mlb",
    simulations: 2000,
    home: { ptsFor: 5.2, ptsAgainst: 4.1, recentScores: [5, 6, 4, 5, 7] },
    away: { ptsFor: 4.8, ptsAgainst: 4.5, recentScores: [4, 5, 3, 5, 6] },
  });
  assert.ok(result);
  assert.ok(result!.homeWinProbability + result!.awayWinProbability <= 1.01);
  assert.ok(result!.homeProjectedScore > 0);
  assert.ok(result!.awayProjectedScore > 0);
});
