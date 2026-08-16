import assert from "node:assert/strict";
import test from "node:test";
import { countsByMarketFamily, nonOuCandidateDiagnostic } from "./coachMarketDiagnostics.ts";

test("diagnostics count mixed market families without treating them as props", () => {
  const picks = [
    { game: "A @ B", market: "Moneyline", pick: "A ML", odds: -110, isProp: false },
    { game: "C @ D", market: "Spread", pick: "C -2.5", odds: -110, isProp: false },
    { game: "E @ F", market: "Team Total", pick: "E Over 3.5", odds: -110, isProp: false },
    { game: "G @ H", market: "Points", pick: "Star Over 20.5", odds: -110, isProp: true, propLine: 20.5 },
  ];
  assert.deepEqual(countsByMarketFamily(picks), {
    moneyline: 1, spread: 1, gameTotal: 0, teamTotal: 1, playerOu: 1, milestone: 0, alternate: 0,
  });
  assert.equal(nonOuCandidateDiagnostic(picks[0]).marketFamily, "moneyline");
});
