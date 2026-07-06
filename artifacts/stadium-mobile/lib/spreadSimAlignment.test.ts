import assert from "node:assert/strict";
import test from "node:test";
import { simPrefersPlusPoints, enforceSimAlignedSpreadPicks, isCloseGameForTeamSpread } from "./spreadSimAlignment.ts";

const tightSim = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.494,
  awayWinProbability: 0.506,
  tieProbability: 0,
  homeProjectedScore: 4.5,
  awayProjectedScore: 4.52,
  mostLikelyWinner: "away" as const,
  mostLikelyWinnerPct: 0.506,
  confidenceScore: 50,
};

test("simPrefersPlusPoints when home lays -1.5 but projects -0.02 margin", () => {
  assert.equal(simPrefersPlusPoints(tightSim, "home", -1.5), true);
});

test("simPrefersPlusPoints false when already on +1.5", () => {
  assert.equal(simPrefersPlusPoints(tightSim, "home", 1.5), false);
});

test("isCloseGameForTeamSpread true on tight projected margin", () => {
  const game = "New York Mets @ Atlanta Braves";
  assert.equal(
    isCloseGameForTeamSpread(tightSim, "home", [
      { sport: "mlb", game, market: "Spread", pick: "Braves -1.5", odds: 168 },
    ], "Braves"),
    true,
  );
});

test("enforceSimAlignedSpreadPicks swaps Braves -1.5 to +1.5", () => {
  const game = "New York Mets @ Atlanta Braves";
  const result = enforceSimAlignedSpreadPicks(
    [
      {
        game,
        market: "Spread",
        pick: "Braves -1.5",
        odds: 168,
        isProp: false,
        sport: "mlb",
      },
    ],
    new Map([[game, tightSim]]),
    {
      realOdds: [
        {
          sport: "mlb",
          game,
          market: "Spread",
          pick: "Braves -1.5",
          odds: 168,
        },
        {
          sport: "mlb",
          game,
          market: "Spread",
          pick: "Braves +1.5",
          odds: -190,
        },
      ],
    },
  );
  assert.equal(result.swapped, 1);
  assert.match(result.picks[0]!.pick, /\+1\.5/);
});
