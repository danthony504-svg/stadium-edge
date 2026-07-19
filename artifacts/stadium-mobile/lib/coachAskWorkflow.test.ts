import assert from "node:assert/strict";
import test from "node:test";
import {
  armCoachAskValueCalcWatchdog,
  beginCoachAskRequest,
  cancelCoachAskRequest,
  coachAskAnswerVisible,
  coachAskRequestMatches,
  coachAskWorkflowIndex,
  COACH_ASK_VALUE_CALC_TIMEOUT_MS,
  isSupersededCoachQaAssistant,
  setCoachAskLifecyclePhase,
  withCoachAskValueCalcTimeout,
  CoachAskValueCalcError,
} from "./coachAskWorkflow.ts";

test("coach ask lifecycle advances through value calc to visible answer", () => {
  cancelCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  assert.equal(setCoachAskLifecyclePhase("req-a", 1, "value-calculation-start"), 6);
  assert.equal(setCoachAskLifecyclePhase("req-a", 1, "value-calculation-success"), 7);
  assert.equal(setCoachAskLifecyclePhase("req-a", 1, "response-received"), 7);
  assert.equal(
    setCoachAskLifecyclePhase("req-a", 1, "assistant-message-committed", { answerVisible: true }),
    8,
  );
  assert.equal(coachAskAnswerVisible("req-a", 1), true);
  assert.equal(setCoachAskLifecyclePhase("req-a", 1, "progress-complete"), 8);
});

test("coach ask lifecycle ignores stale request ids", () => {
  cancelCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  assert.equal(setCoachAskLifecyclePhase("req-b", 1, "value-calculation-start"), null);
  assert.equal(setCoachAskLifecyclePhase("req-a", 2, "value-calculation-start"), null);
  assert.equal(coachAskWorkflowIndex("req-a", 1), 1);
});

test("progress-complete blocked until answer is visible", () => {
  cancelCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  setCoachAskLifecyclePhase("req-a", 1, "value-calculation-success");
  assert.equal(setCoachAskLifecyclePhase("req-a", 1, "progress-complete"), 7);
  assert.equal(coachAskAnswerVisible("req-a", 1), false);
});

test("value calc watchdog fires once for active request", async () => {
  cancelCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  let fired = 0;
  armCoachAskValueCalcWatchdog("req-a", 1, () => {
    fired += 1;
  }, 15);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired, 1);
});

test("cancelCoachAskRequest clears watchdog and stale updates", async () => {
  cancelCoachAskRequest();
  beginCoachAskRequest("req-a", 1);
  let fired = 0;
  armCoachAskValueCalcWatchdog("req-a", 1, () => {
    fired += 1;
  }, 15);
  cancelCoachAskRequest();
  beginCoachAskRequest("req-b", 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired, 0);
  assert.equal(coachAskRequestMatches("req-a", 1), false);
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

test("isSupersededCoachQaAssistant removes retry and empty shells", () => {
  assert.equal(
    isSupersededCoachQaAssistant({
      role: "assistant",
      content: "failed",
      retry: "what spread?",
    }),
    true,
  );
  assert.equal(
    isSupersededCoachQaAssistant({ role: "assistant", content: "" }),
    true,
  );
  assert.equal(
    isSupersededCoachQaAssistant({
      role: "assistant",
      content: "The Lakers are -3.",
    }),
    false,
  );
  assert.equal(
    isSupersededCoachQaAssistant({
      role: "assistant",
      content: "",
      parlayBuild: true,
    }),
    false,
  );
});
