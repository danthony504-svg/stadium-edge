import assert from "node:assert/strict";
import test from "node:test";

import { fightSimToGameResult } from "./ufcFightSimMap.ts";

test("fightSimToGameResult maps fight sim to game simulator shape", () => {
  const out = fightSimToGameResult("ufc", {
    simulations: 10_000,
    awayWinProbability: 0.62,
    homeWinProbability: 0.38,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: 0.62,
    confidenceScore: 71,
    methodRates: {
      away: { ko: 0.2, tko: 0.1, sub: 0.15, decision: 0.55 },
      home: { ko: 0.1, tko: 0.05, sub: 0.2, decision: 0.65 },
    },
    roundWinPct: null,
    meanTotalRounds: 2.41,
    coverHitRates: { "over-2.5": 0.58, "under-2.5": 0.42 },
    outcomes: { homeScores: [2, 3, 1], awayScores: [0, 0, 0] },
  });
  assert.equal(out.sport, "ufc");
  assert.equal(out.simulations, 10_000);
  assert.equal(out.mostLikelyWinner, "away");
  assert.equal(out.tieProbability, 0);
  assert.ok(out.methodRates?.away.ko === 0.2);
  assert.equal(out.homeProjectedScore, 2.41);
  assert.equal(out.awayProjectedScore, 0);
  assert.equal(out.coverHitRates?.["over-2.5"], 0.58);
  assert.equal(out.outcomes?.homeScores.length, 3);
});
