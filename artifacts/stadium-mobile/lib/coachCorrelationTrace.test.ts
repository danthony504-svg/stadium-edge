import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedPick } from "./parsedPick.ts";
import {
  buildCoachCorrelationTrace,
  resetCoachCorrelationTraceForTests,
} from "./coachCorrelationTrace.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(player: string, game: string, edge = 5): BoardScoredLeg {
  const pick: ParsedPick = {
    game,
    market: "Points",
    pick: `${player} Over 20.5 Points`,
    odds: -110,
    isProp: true,
    player,
    sport: "nba",
    finalAiScore: {
      composite: 7,
      grade: "B+",
      confidencePct: 60,
      edgePct: edge,
      simHit: 0.55,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        composite: 7,
        grade: "B+",
        confidencePct: 60,
        edgePct: edge,
        scores: {
          matchup: 7,
          trend: 7,
          lineValue: 7,
          injury: null,
          lineShopping: 7,
          simulation: 7,
        },
      },
    },
  };
  return { pick, rankScore: edge * 10, edgePct: edge };
}

test("correlation trace captures matrix stats and zero-exit candidates", () => {
  resetCoachCorrelationTraceForTests();
  const candidates = [
    leg("Player A", "A @ B", 6),
    leg("Player B", "C @ D", 5),
    leg("Player C", "E @ F", 4),
  ];
  const trace = buildCoachCorrelationTrace({
    requestId: "trace-zero",
    candidates,
    selected: [],
    executionMs: 42,
    correlationTimeout: false,
  });
  assert.equal(trace.candidatesEntering, 3);
  assert.equal(trace.candidatesExiting, 0);
  assert.equal(trace.matrixBuilt, true);
  assert.equal(trace.correlationTimeout, false);
  assert.ok(trace.zeroExitCandidates.length === 3);
  assert.ok(trace.avgCorrelationScore != null);
});
