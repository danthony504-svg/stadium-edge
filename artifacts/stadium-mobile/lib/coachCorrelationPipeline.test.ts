import assert from "node:assert/strict";
import { test } from "node:test";

import {
  advanceCoachBuildStage,
  coachBuildProgressFromPhase,
  coachBuildProgressTick,
  COACH_BUILD_STAGES,
  createCoachBuildProgress,
} from "./coachBuildProgress.ts";
import {
  COACH_CORRELATION_MAX_CANDIDATES,
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

test("runCoachCorrelationStage completes within candidate cap", async () => {
  beginCoachScanPipeline("req-corr-1");
  const scored = [
    leg("A @ B", "P1", "Points", 90),
    leg("C @ D", "P2", "Rebounds", 85),
    leg("E @ F", "P3", "Assists", 80),
    leg("G @ H", "P4", "Threes", 75),
    leg("I @ J", "P5", "Points", 70),
    leg("K @ L", "P6", "Rebounds", 65),
    leg("M @ N", "P7", "Assists", 60),
  ];
  const result = await runCoachCorrelationStage(scored, 5, {
    requestId: "req-corr-1",
    varietySeed: "seed-corr-5leg",
  });
  assert.ok(result.outputTicketCount > 0);
  assert.equal(result.selectedLegs.length, result.outputTicketCount);
  assert.equal(result.requestedLegCount, 5);
  assert.ok(result.candidateTicketCount <= COACH_CORRELATION_MAX_CANDIDATES);
  assert.ok(result.durationMs < COACH_CORRELATION_TIMEOUT_MS + 500);
  assert.equal(result.fallbackUsed, false);
  clearCoachScanPipeline("req-corr-1");
});

test("runCoachCorrelationStage timeout returns pre-correlation ticket with fallback metadata", async () => {
  beginCoachScanPipeline("req-corr-2");
  const scored = Array.from({ length: 7 }, (_, i) =>
    leg(`G${i} @ H${i}`, `P${i}`, "Points", 90 - i),
  );
  const started = Date.now();
  const progressStages: string[] = [];
  const result = await runCoachCorrelationStage(scored, 5, {
    requestId: "req-corr-2",
    varietySeed: "seed-corr-timeout",
    timeoutMs: 1,
    onBuildProgress: (stageId) => {
      progressStages.push(stageId);
    },
  });
  assert.ok(Date.now() - started < 3_000);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.usedFallback, true);
  assert.equal(result.fallbackReason, "correlation-timeout");
  assert.equal(result.outputTicketCount, 5);
  assert.equal(result.selectedLegs.length, 5);
  assert.equal(result.requestedLegCount, 5);
  assert.ok(progressStages.includes("correlation-fallback"));
  assert.ok(progressStages.includes("building-ticket"));
  clearCoachScanPipeline("req-corr-2");
});

test("runCoachCorrelationStage never throws on empty pool", async () => {
  beginCoachScanPipeline("req-corr-3");
  const result = await runCoachCorrelationStage([], 5, {
    requestId: "req-corr-3",
    varietySeed: "seed-corr-3",
  });
  assert.equal(result.outputTicketCount, 0);
  clearCoachScanPipeline("req-corr-3");
});

test("coachBuildProgressTick does not terminal-fail during correlation stage", () => {
  let state = createCoachBuildProgress({ requestId: "r-corr", sendGeneration: 1, legTarget: 5 });
  for (const stageId of [
    "starting",
    "loading-games",
    "matchups",
    "injuries",
    "line-value",
    "simulations",
    "correlation",
  ] as const) {
    state = advanceCoachBuildStage(state, stageId, {
      requestId: "r-corr",
      sendGeneration: 1,
      now: 0,
    });
  }
  state = { ...state, activeStageStartedAt: 0 };
  const ticked = coachBuildProgressTick(state, 60_000);
  assert.equal(ticked.status, "active");
  assert.notEqual(ticked.status, "timed-out");
});

test("runCoachCorrelationStage timeout emits full pipeline trace and resolves", async () => {
  beginCoachScanPipeline("req-trace");
  const scored = Array.from({ length: 7 }, (_, i) =>
    leg(`G${i} @ H${i}`, `P${i}`, "Points", 90 - i),
  );
  const stages: string[] = [];
  const result = await runCoachCorrelationStage(scored, 5, {
    requestId: "req-trace",
    varietySeed: "seed-trace",
    timeoutMs: 1,
    onBuildProgress: (stageId) => stages.push(stageId),
  });
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.outputTicketCount, 5);
  assert.ok(stages.includes("correlation"));
  assert.ok(stages.includes("correlation-fallback"));
  assert.ok(stages.includes("building-ticket"));
  clearCoachScanPipeline("req-trace");
});

test("correlation fallback advances to building-ticket at 95%", () => {
  let state = createCoachBuildProgress({ requestId: "r-fb", sendGeneration: 1, legTarget: 5 });
  for (const stageId of COACH_BUILD_STAGES.map((s) => s.id)) {
    if (stageId === "final-ticket") break;
    state = advanceCoachBuildStage(state, stageId, {
      requestId: "r-fb",
      sendGeneration: 1,
    });
  }
  const snap = coachBuildProgressFromPhase("score", 0, state);
  assert.ok(snap.percent >= 95);
});
