import assert from "node:assert/strict";
import test from "node:test";
import {
  learnedWeightAdjustments,
  strongFactorsFromScores,
} from "./factorLearningCore.ts";

function emptyTally() {
  return { wins: 0, losses: 0, pushes: 0 };
}

test("strongFactorsFromScores: only scores >= 6.5 count", () => {
  const factors = strongFactorsFromScores({
    matchup: 7,
    trend: 6.4,
    lineValue: 8,
    injury: null,
    lineShopping: null,
    simulation: 6.5,
  });
  assert.deepEqual(factors.sort(), ["lineValue", "matchup", "simulation"].sort());
});

test("learnedWeightAdjustments: boosts hot factors, reduces cold", () => {
  const ledger = {
    lineValue: { wins: 12, losses: 4, pushes: 0 },
    matchup: { wins: 4, losses: 12, pushes: 0 },
    trend: emptyTally(),
    injury: emptyTally(),
    lineShopping: emptyTally(),
    simulation: emptyTally(),
  };
  const adj = learnedWeightAdjustments(ledger);
  assert.ok((adj.lineValue ?? 0) > 0);
  assert.ok((adj.matchup ?? 0) < 0);
  assert.equal(adj.trend, undefined);
});
