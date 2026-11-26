import assert from "node:assert/strict";
import test from "node:test";
import type { GameSimulationResult, OddsGame } from "./api.ts";
import { soccerSimulatorMoneyline } from "./soccerSimulatorMoneyline.ts";

const game: OddsGame = {
  id: "match", sport: "soccer", homeTeam: "Brest", awayTeam: "Rennes", commenceTime: "2026-11-26",
  markets: [{ key: "h2h", outcomes: [
    { name: "Rennes", price: 450 }, { name: "Draw", price: 300 }, { name: "Brest", price: -271 },
  ] }],
};
const simulation: GameSimulationResult = {
  sport: "soccer", simulations: 10_000, homeWinProbability: .565, awayWinProbability: .15,
  tieProbability: .285, mostLikelyWinner: "home", mostLikelyWinnerPct: .565, confidenceScore: null,
};

test("Brest at -271 passes and draws count as losses for team moneylines", () => {
  const [brest, rennes, draw] = soccerSimulatorMoneyline(game, simulation);
  assert.equal(brest?.name, "Brest");
  assert.equal(brest?.probability, .565);
  assert.equal(brest?.breakEven.toFixed(3), "0.730");
  assert.equal(brest?.grade, "Pass");
  assert.equal(rennes?.grade, "Pass");
  assert.equal(draw?.grade, "Lean");
});

test("ambiguous two-way prices and inconsistent modeled probabilities are withheld", () => {
  const outcomes = game.markets[0]!.outcomes.filter(outcome => outcome.name !== "Draw");
  assert.deepEqual(soccerSimulatorMoneyline({ ...game, markets: [{ key: "h2h", outcomes }] }, simulation), []);
  assert.deepEqual(soccerSimulatorMoneyline(game, { ...simulation, tieProbability: 0 }), []);
});
