import assert from "node:assert/strict";
import { test } from "node:test";

import { mlbRemainingHalfInnings, runGameMonteCarlo } from "../src/lib/gameMonteCarlo.ts";

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

test("mlbRemainingHalfInnings counts regulation halves correctly", () => {
  assert.deepEqual(mlbRemainingHalfInnings(4, "bottom"), { away: 5, home: 6 });
  assert.deepEqual(mlbRemainingHalfInnings(4, "top"), { away: 6, home: 6 });
});

test("live MLB sim favors the team already ahead late (Orioles 8, Reds 4, bot 4th)", () => {
  const result = runGameMonteCarlo({
    sport: "mlb",
    simulations: 5000,
    home: { ptsFor: 4.5, ptsAgainst: 4.5, recentScores: [4, 5, 3, 5, 4] },
    away: { ptsFor: 4.8, ptsAgainst: 4.2, recentScores: [5, 6, 4, 5, 7] },
    live: {
      homeScore: 4,
      awayScore: 8,
      period: 4,
      inningHalf: "bottom",
    },
  });
  assert.ok(result);
  assert.equal(result!.liveAdjusted, true);
  // Away (Orioles) up 4 in the 4th — should be heavy favorite, not ~50/50.
  assert.ok(result!.awayWinProbability > 0.85, `away win ${result!.awayWinProbability}`);
  assert.ok(result!.homeWinProbability < 0.15, `home win ${result!.homeWinProbability}`);
  assert.ok(result!.awayProjectedScore > result!.homeProjectedScore);
});
