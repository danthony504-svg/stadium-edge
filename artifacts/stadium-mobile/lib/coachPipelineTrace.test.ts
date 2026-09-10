import assert from "node:assert/strict";
import test from "node:test";

import {
  armCoachStageTimer,
  clearCoachStageTimer,
  coachPipelineSnapshot,
  coachPipelineTimeoutMessage,
  markCoachPipelineStage,
  resetCoachPipeline,
  setCoachPipelineTimeoutHandler,
  updateCoachPipelineCounts,
  withCoachStageTimeout,
} from "./coachPipelineTrace.ts";

test("withCoachStageTimeout resolves and records timing", async () => {
  resetCoachPipeline("req-1");
  const out = await withCoachStageTimeout("BuildFinalTicket", async () => {
    markCoachPipelineStage("candidatePropsReceived");
    updateCoachPipelineCounts({ candidateCount: 42 });
    return ["pick"];
  });
  assert.deepEqual(out, ["pick"]);
  const snap = coachPipelineSnapshot();
  assert.equal(snap.asyncStarts.BuildFinalTicket != null, true);
  assert.equal(snap.candidateCount, 42);
});

test("timeout handler fires when promise never resolves", async () => {
  resetCoachPipeline("req-timeout");
  let fired: string | null = null;
  setCoachPipelineTimeoutHandler((stage) => {
    fired = stage;
  });
  armCoachStageTimer("ReturnResponse", 20);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(fired, "ReturnResponse");
  clearCoachStageTimer();
  setCoachPipelineTimeoutHandler(null);
});

test("coachPipelineTimeoutMessage names the stage", () => {
  assert.match(coachPipelineTimeoutMessage("GenerateCoachResponse"), /GenerateCoachResponse/);
});
