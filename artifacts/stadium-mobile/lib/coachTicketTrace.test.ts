import assert from "node:assert/strict";
import test from "node:test";
import { coachMarketFamilyCounts } from "./coachTicketTrace.ts";

test("market pipeline diagnostics preserve all mixed candidate families", () => {
  const counts = coachMarketFamilyCounts([
    { game: "A @ B", market: "Moneyline", pick: "A ML", odds: -110, isProp: false },
    { game: "C @ D", market: "Spread", pick: "C -2.5", odds: -110, isProp: false },
    { game: "E @ F", market: "Team Total", pick: "E Over 3.5", odds: -110, isProp: false },
    { game: "G @ H", market: "Anytime TD", pick: "Runner Anytime TD", odds: 120, isProp: true, propLine: null },
    { game: "I @ J", market: "Points", pick: "Star Over 20.5", odds: -110, isProp: true, propLine: 20.5 },
  ]);
  assert.deepEqual(counts, {
    moneyline: 1, spread: 1, total: 0, teamTotal: 1, playerOu: 1, milestone: 1, alternate: 0,
  });
});
