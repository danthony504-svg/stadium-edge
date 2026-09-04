import assert from "node:assert/strict";
import test from "node:test";

import {
  beginCoachPipelineRun,
  beginCoachPipelineStage,
  coachPipelineRunIsActive,
  endCoachPipelineStage,
  getCoachPipelineRunSnapshot,
  resetCoachPipelineRunTraceForTests,
  supersedeCoachPipelineRun,
  withCoachPipelineStage,
  CoachPipelineStageTimeoutError,
} from "./coachPipelineRunTrace.ts";

test("pipeline run tracks stages with counts and duration", () => {
  resetCoachPipelineRunTraceForTests();
  beginCoachPipelineRun("req-1", 1);
  const handle = beginCoachPipelineStage("req-1", 1, "board-scan-props", 120);
  endCoachPipelineStage(handle, { success: true, candidatesOut: 95 });
  const snap = getCoachPipelineRunSnapshot("req-1");
  assert.ok(snap);
  assert.equal(snap!.stages.length, 1);
  assert.equal(snap!.stages[0]!.candidatesIn, 120);
  assert.equal(snap!.stages[0]!.candidatesOut, 95);
  assert.equal(snap!.stages[0]!.success, true);
  assert.ok(snap!.stages[0]!.durationMs >= 0);
});

test("supersede marks prior run inactive", () => {
  resetCoachPipelineRunTraceForTests();
  beginCoachPipelineRun("req-old", 1);
  supersedeCoachPipelineRun("req-new", 2);
  assert.equal(coachPipelineRunIsActive("req-old", 1), false);
  assert.equal(coachPipelineRunIsActive("req-new", 2), true);
  const old = getCoachPipelineRunSnapshot("req-old");
  assert.ok(old?.superseded);
});

test("withCoachPipelineStage rejects on timeout", async () => {
  resetCoachPipelineRunTraceForTests();
  beginCoachPipelineRun("req-timeout", 1);
  await assert.rejects(
    () =>
      withCoachPipelineStage("req-timeout", 1, "correlation", 50, async () => {
        await new Promise((r) => setTimeout(r, 50));
        return "late";
      }, { timeoutMs: 5 }),
    CoachPipelineStageTimeoutError,
  );
  const snap = getCoachPipelineRunSnapshot("req-timeout");
  assert.ok(snap?.stages[0]?.timeout);
  assert.equal(snap?.stages[0]?.success, false);
});
