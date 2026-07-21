import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  coachRequestWasCompleted,
  completeCoachRequest,
  getCoachRequestPhase,
  isStaleCoachRequest,
  registerActiveCoachRequest,
  resetCoachRequestCompletion,
  setCoachRequestPhase,
} from "./coachRequestCompletion.ts";

const stubPick = { player: "Test", game: "A @ B" } as ParsedPick;

test("completeCoachRequest is idempotent per request", () => {
  resetCoachRequestCompletion();
  registerActiveCoachRequest("req-1", 1);
  let commits = 0;
  const result = {
    requestId: "req-1",
    sendGeneration: 1,
    terminal: "completed" as const,
    picks: [stubPick],
  };
  assert.equal(completeCoachRequest(result, () => {
    commits += 1;
  }), true);
  assert.equal(commits, 1);
  assert.equal(coachRequestWasCompleted(1, "req-1"), true);
  assert.equal(getCoachRequestPhase(), "completed");
  assert.equal(completeCoachRequest(result, () => {
    commits += 1;
  }), true);
  assert.equal(commits, 1);
});

test("stale requestId cannot overwrite active request", () => {
  resetCoachRequestCompletion();
  registerActiveCoachRequest("req-new", 2);
  let commits = 0;
  assert.equal(
    completeCoachRequest(
      {
        requestId: "req-old",
        sendGeneration: 2,
        terminal: "completed",
        picks: [stubPick],
      },
      () => {
        commits += 1;
      },
    ),
    false,
  );
  assert.equal(commits, 0);
  assert.equal(isStaleCoachRequest("req-old", 2), true);
});

test("zero picks commits empty terminal state", () => {
  resetCoachRequestCompletion();
  registerActiveCoachRequest("req-empty", 3);
  let commits = 0;
  assert.equal(
    completeCoachRequest(
      {
        requestId: "req-empty",
        sendGeneration: 3,
        terminal: "empty",
        picks: [],
        legNote: "No legs cleared gates",
      },
      () => {
        commits += 1;
      },
    ),
    true,
  );
  assert.equal(commits, 1);
  assert.equal(getCoachRequestPhase(), "empty");
});

test("timeout with zero usable picks commits a failed terminal state", () => {
  resetCoachRequestCompletion();
  registerActiveCoachRequest("req-timeout", 4);
  let commits = 0;
  assert.equal(
    completeCoachRequest(
      {
        requestId: "req-timeout",
        sendGeneration: 4,
        terminal: "failed",
        picks: [],
        legNote: "Please try again shortly.",
      },
      () => {
        commits += 1;
      },
    ),
    true,
  );
  assert.equal(commits, 1);
  assert.equal(getCoachRequestPhase(), "failed");
});

test("five-leg and fifteen-leg requests both reach completed terminal state", () => {
  for (const legCount of [5, 15]) {
    resetCoachRequestCompletion();
    const requestId = `req-${legCount}`;
    registerActiveCoachRequest(requestId, legCount);
    const picks = Array.from({ length: legCount }, () => stubPick);
    assert.equal(
      completeCoachRequest(
        {
          requestId,
          sendGeneration: legCount,
          terminal: "completed",
          picks,
          legTarget: legCount,
        },
        () => {},
      ),
      true,
    );
    assert.equal(getCoachRequestPhase(), "completed");
    assert.equal(coachRequestWasCompleted(legCount, requestId), true);
  }
});

test("second request does not reuse first request completion key", () => {
  resetCoachRequestCompletion();
  registerActiveCoachRequest("five-leg-a", 10);
  completeCoachRequest(
    { requestId: "five-leg-a", sendGeneration: 10, terminal: "completed", picks: [stubPick] },
    () => {},
  );
  registerActiveCoachRequest("five-leg-b", 11);
  setCoachRequestPhase("correlation", "five-leg-b");
  let commits = 0;
  assert.equal(
    completeCoachRequest(
      { requestId: "five-leg-b", sendGeneration: 11, terminal: "completed", picks: [stubPick, stubPick] },
      () => {
        commits += 1;
      },
    ),
    true,
  );
  assert.equal(commits, 1);
  assert.equal(coachRequestWasCompleted(10, "five-leg-a"), true);
  assert.equal(coachRequestWasCompleted(11, "five-leg-b"), true);
});
