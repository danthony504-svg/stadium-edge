import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countBoardScanStageFunnel,
  summarizeBoardScanEmptyReason,
} from "./boardScanStageDiagnostics.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(grade: string, confPct: number, edge: number): BoardScoredLeg {
  return {
    pick: {
      game: "A @ B",
      market: "spread",
      pick: "A -3.5",
      odds: -110,
      finalAiScore: {
        grade,
        confidencePct: confPct,
        edgePct: edge,
        simHit: 0.58,
        simAligned: true,
        recommends: grade >= "A",
      },
    },
    evPct: 4,
    edgePct: edge,
    confidencePct: confPct,
    grade,
    rankScore: edge,
  };
}

test("countBoardScanStageFunnel tracks edge and confidence drop-off", () => {
  const scored = [leg("B", 80, 3), leg("C+", 40, 2)];
  const funnel = countBoardScanStageFunnel(scored, 5, "balanced");
  assert.equal(funnel.scoredTotal, 2);
  assert.equal(funnel.afterEdge, 2);
  assert.equal(funnel.afterConfidence, 1);
  assert.ok(funnel.strictQualified >= 0);
});

test("summarizeBoardScanEmptyReason names top gate failures", () => {
  const reason = summarizeBoardScanEmptyReason(
    {
      gateFailureCounts: { negative_edge: 12, confidence_below_minimum: 8 },
    } as never,
    { scoredTotal: 20, strictQualified: 0 },
    { combinatorChosen: 0 },
  );
  assert.match(reason, /none passed edge/i);
  assert.match(reason, /negative edge/i);
});
