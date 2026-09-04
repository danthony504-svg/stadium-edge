import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beginCoachPipelineCorrelation,
  clearCoachPipelineState,
  coachPipelineCorrelationTimedOut,
  coachPipelineCurrentPhase,
  markCoachPipelineCorrelationTimedOut,
  settleCoachPipeline,
  transitionCoachPipeline,
} from "./coachPipelineStateMachine.ts";

test("pipeline state machine transitions through correlation → build → complete", () => {
  beginCoachPipelineCorrelation("req-sm-1", "test");
  assert.equal(coachPipelineCurrentPhase("req-sm-1"), "SCORING_CORRELATION");

  transitionCoachPipeline("req-sm-1", "CORRELATION_TIMEOUT_FALLBACK", "timeout");
  assert.equal(coachPipelineCurrentPhase("req-sm-1"), "CORRELATION_TIMEOUT_FALLBACK");
  assert.equal(coachPipelineCorrelationTimedOut("req-sm-1"), false);

  markCoachPipelineCorrelationTimedOut("req-sm-1");
  assert.equal(coachPipelineCorrelationTimedOut("req-sm-1"), true);

  transitionCoachPipeline("req-sm-1", "BUILDING_FINAL_TICKET", "fallback-ticket-built");
  transitionCoachPipeline("req-sm-1", "FINAL_TICKET_READY", "ticket-ready");
  settleCoachPipeline("req-sm-1", "done");
  assert.equal(coachPipelineCurrentPhase("req-sm-1"), "COMPLETE");

  clearCoachPipelineState("req-sm-1");
  assert.equal(coachPipelineCurrentPhase("req-sm-1"), null);
});
