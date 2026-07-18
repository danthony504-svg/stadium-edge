import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COACH_CORRELATION_BATCH_SIZE,
  COACH_CORRELATION_TIMEOUT_MS,
  runCoachCorrelationStage,
} from "./coachCorrelationPipeline.ts";
import { beginCoachScanPipeline, clearCoachScanPipeline } from "./coachScanPipeline.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

function leg(game: string, player: string, market: string, composite = 80): BoardScoredLeg {
  return {
    pick: {
      game,
      market,
      pick: `${player} Over 1.5 ${market}`,
      player,
      isProp: true,
      odds: 600,
      propSide: "Over",
      propLine: 1.5,
      finalAiScore: {
        composite,
        edgePct: 5,
        confidencePct: 60,
        simHit: 0.55,
        simAligned: true,
        grade: "B+",
        recommends: true,
      },
    },
    evPct: 10,
    edgePct: 5,
    confidencePct: 60,
    impliedProbPct: 20,
    lineShoppingScore: 50,
    grade: "B+",
    simHit: 0.55,
    composite,
    rankScore: composite,
  };
}

test("runCoachCorrelationStage completes with batched candidate scoring", async () => {
  beginCoachScanPipeline("req-corr-1");
  const scored = [
    leg("A @ B", "P1", "Points", 90),
    leg("C @ D", "P2", "Rebounds", 85),
    leg("E @ F", "P3", "Assists", 80),
    leg("G @ H", "P4", "Threes", 75),
    leg("I @ J", "P5", "Points", 70),
  ];
  const result = await runCoachCorrelationStage(scored, 3, {
    requestId: "req-corr-1",
    varietySeed: "seed-corr-1",
  });
  assert.ok(result.outputTicketCount > 0);
  assert.ok(result.correlationsScored > 0);
  assert.ok(result.candidateTicketCount > 0);
  assert.equal(result.timedOut, false);
  clearCoachScanPipeline("req-corr-1");
});

test("runCoachCorrelationStage uses fallback when candidates time out", async () => {
  beginCoachScanPipeline("req-corr-2");
  const scored = [
    leg("A @ B", "P1", "Points"),
    leg("C @ D", "P2", "Rebounds"),
    leg("E @ F", "P3", "Assists"),
    leg("G @ H", "P4", "Threes"),
    leg("I @ J", "P5", "Points"),
  ];
  const started = Date.now();
  const result = await runCoachCorrelationStage(scored, 3, {
    requestId: "req-corr-2",
    varietySeed: "seed-corr-2",
    timeoutMs: 1,
  });
  assert.ok(Date.now() - started < COACH_CORRELATION_TIMEOUT_MS + 2_000);
  assert.ok(result.outputTicketCount > 0);
  assert.ok(result.timedOut || result.correlationsScored < result.candidateTicketCount);
  clearCoachScanPipeline("req-corr-2");
});

test("runCoachCorrelationStage never throws on empty qualifying pool", async () => {
  beginCoachScanPipeline("req-corr-3");
  const result = await runCoachCorrelationStage([], 3, {
    requestId: "req-corr-3",
    varietySeed: "seed-corr-3",
  });
  assert.equal(result.outputTicketCount, 0);
  assert.equal(result.exceptions.length, 0);
  clearCoachScanPipeline("req-corr-3");
});

test("COACH_CORRELATION_BATCH_SIZE is bounded", () => {
  assert.ok(COACH_CORRELATION_BATCH_SIZE >= 2);
  assert.ok(COACH_CORRELATION_BATCH_SIZE <= 8);
});
