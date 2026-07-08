import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "../components/PickCard.tsx";
import { enforceConsistentGameSides, simFavoredTeamSide } from "./gameSideConsistency.ts";

const GAME = "New York Mets @ Atlanta Braves";

function leg(pick: string, market = "Spread"): ParsedPick {
  return {
    game: GAME,
    market,
    pick,
    odds: 100,
    isProp: false,
    sport: "mlb",
  };
}

test("simFavoredTeamSide picks away when Mets lead win prob", () => {
  const side = simFavoredTeamSide({
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.46,
    awayWinProbability: 0.54,
    tieProbability: 0,
    homeProjectedScore: 4.5,
    awayProjectedScore: 4.5,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: 0.54,
    confidenceScore: 55,
  });
  assert.equal(side, "away");
});

test("enforceConsistentGameSides drops opposing alt spreads with mismatched game labels", () => {
  const picks = [
    leg("Orioles +1", "Alt Spread"),
    {
      ...leg("Cubs -1", "Alt Spread"),
      game: "Chicago Cubs @ Baltimore Orioles",
    },
  ];
  picks[0]!.game = "Cubs @ Orioles";
  const r = enforceConsistentGameSides(picks);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
});

test("enforceConsistentGameSides drops opposing alt spreads on same full game label", () => {
  const game = "Chicago Cubs @ Baltimore Orioles";
  const picks = [
    { ...leg("Orioles +1", "Alt Spread"), game },
    { ...leg("Cubs -1", "Alt Spread"), game },
  ];
  const r = enforceConsistentGameSides(picks);
  assert.equal(r.picks.length, 1);
  assert.equal(r.dropped, 1);
});

test("enforceConsistentGameSides drops opposing ML and spread on same game", () => {
  const sim = new Map([
    [
      GAME,
      {
        sport: "mlb",
        simulations: 10_000,
        homeWinProbability: 0.46,
        awayWinProbability: 0.54,
        tieProbability: 0,
        homeProjectedScore: 4.5,
        awayProjectedScore: 4.5,
        mostLikelyWinner: "away" as const,
        mostLikelyWinnerPct: 0.54,
        confidenceScore: 55,
        coverHitRates: {
          [`${GAME}|moneyline|mets ml`.toLowerCase()]: 0.54,
          [`${GAME}|spread|braves -1.5`.toLowerCase()]: 0.38,
        },
      },
    ],
  ]);
  const picks = [leg("Mets ML", "Moneyline"), leg("Braves -1.5", "Spread")];
  const r = enforceConsistentGameSides(picks, { simByGame: sim });
  assert.equal(r.picks.length, 1);
  assert.match(r.picks[0]!.pick, /Mets/i);
  assert.equal(r.dropped, 1);
});
