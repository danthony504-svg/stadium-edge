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
