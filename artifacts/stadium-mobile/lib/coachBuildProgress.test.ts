import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coachBuildProgressFromPhase,
  coachBuildProgressSignature,
} from "./coachBuildProgress.ts";

test("coachBuildProgressFromPhase reaches 100% when legs stream", () => {
  const done = coachBuildProgressFromPhase("board-scan", 3);
  assert.equal(done.percent, 100);
  assert.equal(done.stageIndex, 9);
});

test("coachBuildProgressFromPhase advances with real build phases", () => {
  const context = coachBuildProgressFromPhase("context", 0);
  const scan = coachBuildProgressFromPhase("board-scan", 0);
  assert.ok(scan.percent > context.percent);
  assert.ok(scan.stageIndex > context.stageIndex);
});

test("coachBuildProgressFromPhase maps 5-leg build 64% → 74% → 93% → 100%", () => {
  const boardScan = coachBuildProgressFromPhase("board-scan", 0);
  assert.equal(boardScan.phase, "board-scan");
  assert.equal(boardScan.percent, 64);
  assert.equal(boardScan.matchupComplete, true);
  assert.equal(boardScan.injuryComplete, true);
  assert.equal(boardScan.lineValueComplete, false);
  assert.equal(boardScan.correlationComplete, false);
  assert.equal(boardScan.ticketComplete, false);

  const stream = coachBuildProgressFromPhase("stream", 0);
  assert.equal(stream.phase, "stream");
  assert.equal(stream.percent, 74);
  assert.equal(stream.lineValueComplete, true);
  assert.equal(stream.correlationComplete, true);
  assert.equal(stream.ticketComplete, false);

  const score = coachBuildProgressFromPhase("score", 0);
  assert.equal(score.phase, "score");
  assert.equal(score.percent, 93);
  assert.equal(score.correlationComplete, true);
  assert.equal(score.ticketComplete, false);

  const done = coachBuildProgressFromPhase("score", 5);
  assert.equal(done.percent, 100);
  assert.equal(done.ticketComplete, true);
});

test("coachBuildProgressSignature dedupes identical updates", () => {
  const a = coachBuildProgressSignature({
    requestId: "req-1",
    stage: "board-scan",
    percent: 64,
    ticketId: "t-1",
  });
  const b = coachBuildProgressSignature({
    requestId: "req-1",
    stage: "board-scan",
    percent: 64,
    ticketId: "t-1",
  });
  assert.equal(a, b);
});
