import assert from "node:assert/strict";
import test from "node:test";
import {
  bestGameLine,
  mergeOddsEntries,
  type EvaluatedGameLine,
} from "./gameLineOptimizer.ts";

function mockEval(composite: number, edge: number, winProb: number): EvaluatedGameLine {
  return {
    entry: {
      sport: "mlb",
      game: "A @ B",
      market: "Spread",
      pick: "B +1.5",
      odds: -110,
      edge,
    },
    pick: { game: "A @ B", market: "Spread", pick: "B +1.5", odds: -110, isProp: false },
    finalAiScore: {
      composite,
      grade: "B+",
      confidencePct: 60,
      edgePct: edge,
      simHit: winProb,
      simAligned: winProb >= 0.52,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite, grade: "B+", confidencePct: 60, edgePct: edge },
    },
    winProb,
    edgePct: edge,
  };
}

test("bestGameLine picks highest Final AI composite", () => {
  const best = bestGameLine([
    mockEval(7.2, 1.5, 0.55),
    mockEval(8.1, 0.5, 0.62),
    mockEval(7.8, 3.0, 0.48),
  ]);
  assert.equal(best?.finalAiScore.composite, 8.1);
});

test("bestGameLine tie-breaks on edge then win prob", () => {
  const best = bestGameLine([mockEval(8.0, 1.0, 0.54), mockEval(8.0, 2.5, 0.51)]);
  assert.equal(best?.edgePct, 2.5);
});

test("mergeOddsEntries prefers later eval-line edge over chat context", () => {
  const merged = mergeOddsEntries(
    [{ sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +1.5", odds: -110, edge: null }],
    [{ sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +1.5", odds: -105, edge: 2.1 }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.odds, -105);
  assert.equal(merged[0]?.edge, 2.1);
});
