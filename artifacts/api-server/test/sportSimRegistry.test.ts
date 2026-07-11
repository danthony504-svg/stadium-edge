import assert from "node:assert/strict";
import { test } from "node:test";

import { runSportGameMonteCarlo, sportSimModelForSport } from "../src/lib/sportSim/registry.ts";

test("sportSimModelForSport maps each major sport", () => {
  assert.equal(sportSimModelForSport("mlb"), "mlb-inning");
  assert.equal(sportSimModelForSport("nba"), "nba-possession");
  assert.equal(sportSimModelForSport("wnba"), "wnba-possession");
  assert.equal(sportSimModelForSport("nfl"), "nfl-drive");
  assert.equal(sportSimModelForSport("nhl"), "nhl-shift");
  assert.equal(sportSimModelForSport("soccer"), "soccer-xg");
});

test("runSportGameMonteCarlo runs 10k MLB inning draws", () => {
  const result = runSportGameMonteCarlo({
    sport: "mlb",
    simulations: 10_000,
    home: { ptsFor: 5.1, ptsAgainst: 4.2, recentScores: [4, 5, 6, 5, 7] },
    away: { ptsFor: 4.4, ptsAgainst: 4.8, recentScores: [3, 4, 5, 4, 6] },
    retainOutcomes: true,
    coverQueries: [{ id: "home-ml", kind: "ml", teamSide: "home" }],
  });
  assert.ok(result);
  assert.equal(result!.simModel, "mlb-inning");
  assert.equal(result!.simulations, 10_000);
  assert.ok((result!.coverHitRates?.["home-ml"] ?? 0) > 0);
});

test("runSportGameMonteCarlo runs NBA possession model", () => {
  const result = runSportGameMonteCarlo({
    sport: "nba",
    simulations: 5000,
    home: { ptsFor: 114, ptsAgainst: 110, recentScores: [110, 112, 118, 109, 115] },
    away: { ptsFor: 108, ptsAgainst: 112, recentScores: [105, 111, 107, 113, 110] },
  });
  assert.ok(result);
  assert.equal(result!.simModel, "nba-possession");
  assert.ok(result!.homeProjectedScore > 95);
});
