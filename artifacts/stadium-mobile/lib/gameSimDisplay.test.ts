import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGameWinDisplay, weatherSettingLabel } from "./gameSimDisplay.ts";

test("normalizeGameWinDisplay accounts for ties and sums to ~100%", () => {
  const n = normalizeGameWinDisplay({
    sport: "mlb",
    simulations: 10_000,
    homeWinProbability: 0.496,
    awayWinProbability: 0.498,
    tieProbability: 0.006,
    homeProjectedScore: 4.5,
    awayProjectedScore: 4.52,
    mostLikelyWinner: "away",
    mostLikelyWinnerPct: 0.498,
    confidenceScore: 50,
  });
  assert.ok(Math.abs(n.awayPct + n.homePct - 1) < 0.001);
  assert.equal(n.favoredSide, "away");
  assert.ok(n.tiePct > 0);
});

test("weatherSettingLabel for domed parks", () => {
  assert.match(
    weatherSettingLabel({ climateControlled: true })!,
    /Roof: Closed/i,
  );
  assert.match(
    weatherSettingLabel({ venue: "Tropicana Field" })!,
    /Weather impact: None/i,
  );
});
