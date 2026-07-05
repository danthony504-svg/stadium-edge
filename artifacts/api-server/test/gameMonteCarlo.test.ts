import assert from "node:assert/strict";
import { test } from "node:test";

import { coverQueryHits, runGameMonteCarlo } from "../src/lib/gameMonteCarlo.ts";

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

test("coverQueryHits scores spread and total covers", () => {
  assert.equal(
    coverQueryHits({ id: "s", kind: "spread", teamSide: "home", line: -1.5 }, 5, 2),
    true,
  );
  assert.equal(
    coverQueryHits({ id: "s", kind: "spread", teamSide: "home", line: -1.5 }, 4, 3),
    false,
  );
  assert.equal(coverQueryHits({ id: "t", kind: "total", totalSide: "over", line: 8.5 }, 5, 4), true);
  assert.equal(coverQueryHits({ id: "t", kind: "total", totalSide: "under", line: 8.5 }, 5, 4), false);
});

test("runGameMonteCarlo returns coverHitRates for queries", () => {
  const result = runGameMonteCarlo({
    sport: "mlb",
    simulations: 5000,
    home: { ptsFor: 5.5, ptsAgainst: 4.0, recentScores: [5, 6, 5, 7, 5] },
    away: { ptsFor: 4.0, ptsAgainst: 5.0, recentScores: [3, 4, 4, 5, 4] },
    coverQueries: [
      { id: "home-ml", kind: "ml", teamSide: "home" },
      { id: "home-15", kind: "spread", teamSide: "home", line: -1.5 },
    ],
    retainOutcomes: true,
  });
  assert.ok(result?.coverHitRates);
  assert.ok((result!.coverHitRates!["home-ml"] ?? 0) > 0.4);
  assert.ok((result!.coverHitRates!["home-15"] ?? 0) < (result!.coverHitRates!["home-ml"] ?? 1));
  assert.ok(result?.outcomes);
  assert.equal(result!.outcomes!.homeScores.length, 5000);
});
