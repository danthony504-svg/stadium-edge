import test from "node:test";
import assert from "node:assert/strict";

import { selectTopBoardLegs, type BoardScoredLeg } from "./ticketStaging.ts";
import {
  activeCoachScanRequestId,
  beginCoachScanPipeline,
  clearCoachScanPipeline,
  coachPipelineIsDev,
  coachScanPipelineIsStale,
  isCoachBackgroundScanRequestId,
  resolveCoachScanRequestId,
  shouldSkipCorrelationScoring,
} from "./coachScanPipeline.ts";

function leg(game: string, player: string, market: string): BoardScoredLeg {
  return {
    pick: {
      game,
      market,
      pick: `${player} Over 1.5 ${market}`,
      player,
      isProp: true,
      odds: 600,
      finalAiScore: {
        composite: 80,
        edgePct: 5,
        confidencePct: 60,
        simHit: 55,
        simAligned: true,
        grade: "B+",
      },
    },
    evPct: 10,
    edgePct: 5,
    confidencePct: 60,
    impliedProbPct: 20,
    lineShoppingScore: 50,
    grade: "B+",
    simHit: 55,
    composite: 80,
    rankScore: 80,
  };
}

test("selectTopBoardLegs terminates when same-game dedupe blocks all candidates", () => {
  const sameGame = leg("A @ B", "P1", "Points");
  const ranked = [
    sameGame,
    { ...sameGame, pick: { ...sameGame.pick, player: "P2", pick: "P2 Over 2.5 Points" } },
    leg("C @ D", "P3", "Rebounds"),
    leg("E @ F", "P4", "Assists"),
    leg("G @ H", "P5", "Threes"),
  ];
  const started = Date.now();
  const out = selectTopBoardLegs(ranked, 5, "seed", Date.now() + 5_000);
  assert.ok(out.length <= 5);
  assert.ok(Date.now() - started < 2_000, "should not infinite-loop");
});

test("shouldSkipCorrelationScoring when too few candidates", () => {
  assert.equal(shouldSkipCorrelationScoring(4, 5), true);
  assert.equal(shouldSkipCorrelationScoring(8, 5), false);
});

test("coachScanPipelineIsStale rejects stale requestId", () => {
  beginCoachScanPipeline("req-a");
  assert.equal(coachScanPipelineIsStale("req-b"), true);
  assert.equal(coachScanPipelineIsStale("req-a"), false);
  clearCoachScanPipeline("req-a");
});

test("resolveCoachScanRequestId uses active pipeline id when explicit is missing", () => {
  beginCoachScanPipeline("req-active");
  assert.equal(resolveCoachScanRequestId(undefined, "test"), "req-active");
  assert.equal(resolveCoachScanRequestId("req-explicit", "test"), "req-explicit");
  clearCoachScanPipeline("req-active");
});

test("resolveCoachScanRequestId rejects unknown literal", () => {
  beginCoachScanPipeline("req-active");
  if (coachPipelineIsDev()) {
    assert.throws(
      () => resolveCoachScanRequestId("unknown", "test"),
      /missing requestId/,
    );
  } else {
    assert.equal(resolveCoachScanRequestId("unknown", "test"), "req-active");
  }
  clearCoachScanPipeline("req-active");
});

test("activeCoachScanRequestId tracks beginCoachScanPipeline", () => {
  assert.equal(activeCoachScanRequestId(), null);
  beginCoachScanPipeline("req-track");
  assert.equal(activeCoachScanRequestId(), "req-track");
  clearCoachScanPipeline("req-track");
  assert.equal(activeCoachScanRequestId(), null);
});

test("background slate-pre scan does not register user pipeline", () => {
  beginCoachScanPipeline("req-live");
  beginCoachScanPipeline("slate-pre-123");
  assert.equal(activeCoachScanRequestId(), "req-live");
  assert.equal(isCoachBackgroundScanRequestId("slate-pre-123"), true);
  clearCoachScanPipeline("req-live");
});
