import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  beginCoachFinalizeRequest,
  coachBuildWorkflowIndex,
  coachFinalizeProgressPercent,
  coachFinalizeShouldTimeout,
  coachFinalizeWorkflowIndex,
  getCoachFinalizeRecord,
  isCoachFinalizeLocked,
  markCoachCorrelationComplete,
  markCoachFinalizeCardsSaved,
  markCoachFinalizeEmpty,
  markCoachFinalizeInterrupted,
  markCoachFinalizeSelected,
  markCoachLineValueReady,
  resetCoachFinalizeForTests,
  tryAcquireCoachFinalizeLock,
} from "./coachFinalize.ts";

describe("coachFinalize", () => {
  test("idempotent lock allows first finalize only", () => {
    resetCoachFinalizeForTests();
    beginCoachFinalizeRequest("req-1", 5);
    assert.equal(tryAcquireCoachFinalizeLock("req-1"), true);
    assert.equal(tryAcquireCoachFinalizeLock("req-1"), false);
    assert.equal(isCoachFinalizeLocked("req-1"), true);
    markCoachFinalizeCardsSaved("req-1", 5);
    assert.equal(getCoachFinalizeRecord("req-1")?.phase, "complete");
    assert.equal(tryAcquireCoachFinalizeLock("req-1"), false);
  });

  test("zero picks finishes empty not stuck correlating", () => {
    resetCoachFinalizeForTests();
    beginCoachFinalizeRequest("req-empty", 5);
    markCoachCorrelationComplete("req-empty");
    assert.equal(tryAcquireCoachFinalizeLock("req-empty"), true);
    markCoachFinalizeSelected("req-empty", 0);
    markCoachFinalizeEmpty("req-empty");
    const record = getCoachFinalizeRecord("req-empty");
    assert.equal(record?.phase, "empty");
    assert.equal(record?.cardsSaved, true);
    assert.equal(coachFinalizeWorkflowIndex(record), 9);
    assert.equal(coachFinalizeProgressPercent(9), 100);
  });

  test("timeout triggers after 15s in correlating", () => {
    resetCoachFinalizeForTests();
    beginCoachFinalizeRequest("req-timeout", 5);
    markCoachCorrelationComplete("req-timeout");
    const record = getCoachFinalizeRecord("req-timeout")!;
    assert.equal(coachFinalizeShouldTimeout(record, record.correlationCompleteAt! + 14_999), false);
    assert.equal(coachFinalizeShouldTimeout(record, record.correlationCompleteAt! + 15_001), true);
  });

  test("interrupted is terminal", () => {
    resetCoachFinalizeForTests();
    beginCoachFinalizeRequest("req-int", 5);
    tryAcquireCoachFinalizeLock("req-int");
    markCoachFinalizeInterrupted("req-int", "Build interrupted");
    assert.equal(getCoachFinalizeRecord("req-int")?.phase, "interrupted");
    assert.equal(coachFinalizeWorkflowIndex(getCoachFinalizeRecord("req-int")), 9);
  });

  test("injury complete then line value advances workflow past 40%", () => {
    resetCoachFinalizeForTests();
    beginCoachFinalizeRequest("req-flow", 5);
    assert.equal(coachBuildWorkflowIndex(getCoachFinalizeRecord("req-flow"), { step: "loading" }), 3);
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-flow"), { step: "complete" }),
      4,
    );
    markCoachLineValueReady("req-flow");
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-flow"), { step: "complete" }),
      6,
    );
  });
});
