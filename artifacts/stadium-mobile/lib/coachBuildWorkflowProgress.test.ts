import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCoachFinalizeRequest,
  beginCoachCorrelationPhase,
  coachBuildWorkflowIndex,
  coachFinalizeProgressPercent,
  getCoachFinalizeRecord,
  markCoachCorrelationComplete,
  markCoachLineValueReady,
  resetCoachFinalizeForTests,
} from "./coachFinalize.ts";
import {
  markCoachBuildPipelineStage,
  resetCoachBuildPipelineStagesForTests,
} from "./coachBuildPipelineStage.ts";

test("workflow index advances in stage order without skipping correlation", () => {
  resetCoachFinalizeForTests();
  resetCoachBuildPipelineStagesForTests();
  const requestId = "progress-order";
  beginCoachFinalizeRequest(requestId, 5);

  assert.equal(coachBuildWorkflowIndex(getCoachFinalizeRecord(requestId), { step: "loading" }), 3);
  assert.equal(coachBuildWorkflowIndex(getCoachFinalizeRecord(requestId), { step: "complete" }), 4);
  assert.equal(coachFinalizeProgressPercent(4), 52);

  markCoachBuildPipelineStage(requestId, "pricingStarted");
  assert.equal(coachBuildWorkflowIndex(getCoachFinalizeRecord(requestId), { step: "complete" }), 5);
  assert.equal(coachFinalizeProgressPercent(5), 64);

  markCoachLineValueReady(requestId);
  assert.equal(coachBuildWorkflowIndex(getCoachFinalizeRecord(requestId), { step: "complete" }), 6);
  assert.equal(coachFinalizeProgressPercent(6), 74);

  beginCoachCorrelationPhase(requestId);
  assert.equal(
    coachBuildWorkflowIndex(getCoachFinalizeRecord(requestId), { step: "complete" }, {
      correlationRecord: { step: "loading" },
    }),
    6,
  );

  markCoachCorrelationComplete(requestId);
  assert.equal(
    coachBuildWorkflowIndex(getCoachFinalizeRecord(requestId), { step: "complete" }, {
      correlationRecord: { step: "complete" },
    }),
    7,
  );
  assert.equal(coachFinalizeProgressPercent(7), 84);
});
