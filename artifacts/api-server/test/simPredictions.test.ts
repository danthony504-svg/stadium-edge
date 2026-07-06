import assert from "node:assert/strict";
import test from "node:test";

import { buildSimPredictionRow, edgeBandFromWinProbs, gradePredictedWinner } from "../src/lib/simPredictionsCore.ts";

test("buildSimPredictionRow assigns edge bands from win probability", () => {
  const noEdge = buildSimPredictionRow({
    sport: "mlb",
    eventId: "401",
    game: "PHI @ KC",
    homeTeam: "Royals",
    awayTeam: "Phillies",
    homeWinProbability: 0.52,
    awayWinProbability: 0.48,
    mostLikelyWinner: "home",
    simulations: 10_000,
    startsAt: "2026-07-06T23:00:00Z",
  });
  assert.equal(noEdge.edgeBand, "no_edge");

  const strong = buildSimPredictionRow({
    sport: "mlb",
    eventId: "402",
    game: "A @ B",
    homeTeam: "B",
    awayTeam: "A",
    homeWinProbability: 0.7,
    awayWinProbability: 0.3,
    mostLikelyWinner: "home",
    simulations: 10_000,
  });
  assert.equal(strong.edgeBand, "strong_edge");
  assert.equal(strong.predictedTeam, "B");
});

test("gradePredictedWinner compares final scores", () => {
  assert.deepEqual(gradePredictedWinner("home", 5, 3), { status: "correct", actualWinner: "home" });
  assert.deepEqual(gradePredictedWinner("away", 5, 3), { status: "incorrect", actualWinner: "home" });
  assert.deepEqual(gradePredictedWinner("home", 2, 2), { status: "push", actualWinner: "tie" });
});
