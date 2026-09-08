import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameCoverQuery,
  deriveCoverHitRatesFromOutcomes,
  enrichGameSimCoverRatesFromLines,
  gameSimHitForPick,
} from "./gameSimScoring.ts";

const GAME = "Away @ Home";

test("enrichGameSimCoverRatesFromLines derives alt spread hit rates from outcomes", () => {
  const outcomes = {
    homeScores: [5, 3, 7, 2, 4],
    awayScores: [2, 4, 3, 5, 1],
  };
  const sim = {
    sport: "mlb",
    simulations: 5,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    tieProbability: 0,
    mostLikelyWinner: "home" as const,
    mostLikelyWinnerPct: 0.6,
    confidenceScore: 60,
    outcomes,
  };
  const lines = [
    {
      sport: "mlb",
      game: GAME,
      market: "Alt Spread",
      pick: "Away +2.5",
      odds: 140,
    },
    {
      sport: "mlb",
      game: GAME,
      market: "Alt Total",
      pick: "Over 11.5",
      odds: 130,
    },
  ];
  const enriched = enrichGameSimCoverRatesFromLines(sim, lines);
  const spreadPick = {
    game: GAME,
    market: "Alt Spread",
    pick: "Away +2.5",
    odds: 140,
    isProp: false,
    sport: "mlb",
  };
  const hit = gameSimHitForPick(spreadPick, enriched);
  assert.ok(hit != null && hit > 0 && hit < 1);
  const q = buildGameCoverQuery(spreadPick);
  assert.ok(q);
  assert.ok(enriched.coverHitRates?.[q!.id] != null);
});

test("deriveCoverHitRatesFromOutcomes scores arbitrary alt total line", () => {
  const outcomes = {
    homeScores: Array.from({ length: 100 }, () => 4),
    awayScores: Array.from({ length: 100 }, () => 5),
  };
  const pick = {
    game: GAME,
    market: "Alt Total",
    pick: "Over 8.5",
    odds: 120,
    isProp: false,
    sport: "mlb",
  };
  const q = buildGameCoverQuery(pick);
  assert.ok(q);
  const rates = deriveCoverHitRatesFromOutcomes(outcomes, [q!], "mlb");
  assert.equal(rates[q!.id], 1);
});
