import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceCoachAskStage,
  beginCoachAskRequest,
  clearCoachAskRequest,
  coachAskAnswerCommitted,
  coachAskAnswerReady,
  coachAskRequestMatches,
  coachAskWorkflowIndex,
  COACH_ASK_VALUE_CALC_TIMEOUT_MS,
  withCoachAskValueCalcTimeout,
  CoachAskValueCalcError,
} from "./coachAskWorkflow.ts";

test("coachAskWorkflow tracks stages in order for active request", () => {
  clearCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  assert.equal(advanceCoachAskStage("req-a", 1, "question-understood"), 1);
  assert.equal(advanceCoachAskStage("req-a", 1, "live-data-pulled"), 4);
  assert.equal(advanceCoachAskStage("req-a", 1, "key-factors-identified"), 5);
  assert.equal(advanceCoachAskStage("req-a", 1, "value-calc-started"), 6);
  assert.equal(advanceCoachAskStage("req-a", 1, "value-calc-completed"), 7);
  assert.equal(advanceCoachAskStage("req-a", 1, "answer-committed"), 8);
  assert.equal(coachAskAnswerCommitted("req-a", 1), true);
  assert.equal(advanceCoachAskStage("req-a", 1, "answer-ready"), 8);
  assert.equal(coachAskAnswerReady("req-a", 1), true);
  assert.equal(coachAskWorkflowIndex("req-a", 1), 8);
});

test("coachAskWorkflow ignores stale request id and send generation", () => {
  clearCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  assert.equal(advanceCoachAskStage("req-b", 1, "live-data-pulled"), null);
  assert.equal(advanceCoachAskStage("req-a", 2, "live-data-pulled"), null);
  assert.equal(coachAskWorkflowIndex("req-a", 1), 0);
});

test("coachAskWorkflow does not mark answer ready before commit", () => {
  clearCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  advanceCoachAskStage("req-a", 1, "value-calc-completed");
  assert.equal(advanceCoachAskStage("req-a", 1, "answer-ready"), 7);
  assert.equal(coachAskAnswerReady("req-a", 1), false);
});

test("withCoachAskValueCalcTimeout rejects on slow work", async () => {
  await assert.rejects(
    () =>
      withCoachAskValueCalcTimeout(
        new Promise((resolve) => setTimeout(resolve, COACH_ASK_VALUE_CALC_TIMEOUT_MS + 40)),
        20,
      ),
    (err: unknown) => err instanceof CoachAskValueCalcError && err.timedOut,
  );
});

test("coachAskWorkflow resets when a new request begins", () => {
  clearCoachAskRequest();
  beginCoachAskRequest("req-old", 1);
  advanceCoachAskStage("req-old", 1, "value-calc-started");
  clearCoachAskRequest();
  beginCoachAskRequest("req-new", 2);
  assert.equal(coachAskWorkflowIndex("req-new", 2), 0);
  assert.equal(advanceCoachAskStage("req-old", 1, "answer-ready"), null);
  assert.equal(advanceCoachAskStage("req-new", 2, "question-understood"), 1);
});
