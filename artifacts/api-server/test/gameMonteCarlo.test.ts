import assert from "node:assert/strict";
import { test } from "node:test";

import { coverQueryResult, runGameMonteCarlo } from "../src/lib/gameMonteCarlo.ts";

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

test("coverQueryResult scores spread and total covers", () => {
  assert.equal(
    coverQueryResult({ id: "s", kind: "spread", teamSide: "home", line: -1.5 }, 5, 2),
    true,
  );
  assert.equal(
    coverQueryResult({ id: "s", kind: "spread", teamSide: "home", line: -1.5 }, 4, 3),
    false,
  );
  assert.equal(coverQueryResult({ id: "t", kind: "total", totalSide: "over", line: 8.5 }, 5, 4), true);
  assert.equal(coverQueryResult({ id: "t", kind: "total", totalSide: "under", line: 8.5 }, 5, 4), false);
});

test("coverQueryResult scores team totals and period totals", () => {
  assert.equal(
    coverQueryResult({ id: "tt", kind: "teamTotal", teamSide: "home", totalSide: "over", line: 4.5 }, 6, 2),
    true,
  );
  const periodHit = coverQueryResult(
    { id: "q1", kind: "total", totalSide: "over", line: 50, period: "q1" },
    110,
    108,
    "nba",
  );
  assert.equal(typeof periodHit, "boolean");
});

test("coverQueryResult scores race-to markets", () => {
  let hits = 0;
  for (let i = 0; i < 200; i++) {
    if (coverQueryResult({ id: "rt", kind: "raceTo", teamSide: "home", raceTarget: 20 }, 115, 105, "nba")) {
      hits += 1;
    }
  }
  assert.ok(hits > 20 && hits < 180);
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
      { id: "total-over-8", kind: "total", totalSide: "over", line: 8 },
      { id: "home-total-over-4", kind: "teamTotal", teamSide: "home", totalSide: "over", line: 4 },
    ],
    retainOutcomes: true,
  });
  assert.ok(result?.coverHitRates);
  assert.ok((result!.coverHitRates!["home-ml"] ?? 0) > 0.4);
  assert.ok((result!.coverHitRates!["home-15"] ?? 0) < (result!.coverHitRates!["home-ml"] ?? 1));
  assert.equal(typeof result!.coverHitRates!["total-over-8"], "number");
  assert.equal(typeof result!.coverHitRates!["home-total-over-4"], "number");
  assert.ok(result?.outcomes);
  assert.equal(result!.outcomes!.homeScores.length, 5000);
  assert.equal(result!.outcomes!.awayScores.length, 5000);
});
