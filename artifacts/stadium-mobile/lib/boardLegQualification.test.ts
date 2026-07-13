import assert from "node:assert/strict";
import test from "node:test";
import { explainBoardLegQualification } from "./boardLegQualification.ts";

test("explainBoardLegQualification rejects game line with edge but no AI recommend", () => {
  const q = explainBoardLegQualification(
    {
      game: "A @ B",
      market: "Moneyline",
      pick: "A ML",
      odds: 207,
      isProp: false,
    },
    {
      composite: 6,
      grade: "C",
      confidencePct: 60,
      edgePct: 17.3,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 6, grade: "C", confidencePct: 60, edgePct: 17.3, scores: {} as never },
    },
  );
  assert.equal(q.qualifies, false);
  assert.notEqual(q.gate, "qualified_main");
});

test("explainBoardLegQualification accepts qualifying alt spread", () => {
  const q = explainBoardLegQualification(
    {
      game: "A @ B",
      market: "Alt Spread",
      pick: "A -1.5",
      odds: -105,
      isProp: false,
    },
    {
      composite: 7,
      grade: "B-",
      confidencePct: 55,
      edgePct: 2.5,
      simHit: 0.56,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { composite: 7, grade: "B-", confidencePct: 55, edgePct: 2.5, scores: {} as never },
    },
  );
  assert.equal(q.qualifies, true);
  assert.equal(q.role, "alt");
});
