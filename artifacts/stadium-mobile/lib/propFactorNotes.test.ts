import assert from "node:assert/strict";
import test from "node:test";

import { buildPropFactorNote } from "./propFactorNotes.ts";

test("buildPropFactorNote explains high sim hit with negative edge", () => {
  const note = buildPropFactorNote(
    {
      scores: { matchup: 7, trend: 7, lineValue: 4, injury: null, lineShopping: null, simulation: 8 },
      composite: 6.8,
      grade: "B",
      confidencePct: 62,
      edgePct: -1.2,
    },
    { hitProbability: 0.62, completedSims: 10_000, simulations: 10_000, failedSims: 0 },
    -130,
  );
  assert.ok(note?.includes("priced it in"));
});

test("buildPropFactorNote explains low sim hit with high grade", () => {
  const note = buildPropFactorNote(
    {
      scores: { matchup: 8, trend: 8, lineValue: 7, injury: null, lineShopping: null, simulation: 3 },
      composite: 7.5,
      grade: "B+",
      confidencePct: 68,
      edgePct: 2.5,
    },
    { hitProbability: 0.28, completedSims: 10_000, simulations: 10_000, failedSims: 0 },
    -110,
  );
  assert.ok(note?.includes("simulation only hits") || note?.includes("Monte Carlo only hits"));
});
