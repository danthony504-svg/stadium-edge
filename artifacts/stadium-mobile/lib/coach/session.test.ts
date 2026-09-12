import test from "node:test";
import assert from "node:assert/strict";
import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachAbsoluteBudgetMs,
  coachSessionIsTerminal,
  coachSessionShouldKeepBusy,
  coachShortfallNote,
  createCoachSession,
  latchCoachSession,
  resolveCoachOutcome,
} from "./session.ts";

test("6-leg absolute budget is 45s", () => {
  assert.equal(coachAbsoluteBudgetMs(6), 45_000);
});

test("latch permanently blocks keepBusy", () => {
  const session = createCoachSession(1, 6, 1_000);
  assert.equal(coachSessionShouldKeepBusy(session), true);
  latchCoachSession(session, "shortfall");
  assert.equal(coachSessionIsTerminal(session), true);
  assert.equal(coachSessionShouldKeepBusy(session), false);
});

test("beginSend clears terminal latch", () => {
  const session = createCoachSession(1, 6, 1_000);
  latchCoachSession(session, "shown");
  beginCoachSession(session, { sendGen: 2, requestedLegs: 6, now: 5_000 });
  assert.equal(session.outcome, "open");
  assert.equal(session.sendGen, 2);
});

test("shortfall note is honest under-count copy", () => {
  assert.match(coachShortfallNote(6, 3), /only \*\*3\*\*/);
  assert.equal(coachShortfallNote(6, 6), "");
});

test("resolveCoachOutcome maps pick counts", () => {
  assert.equal(resolveCoachOutcome({ pickCount: 6, requestedLegs: 6 }), "shown");
  assert.equal(resolveCoachOutcome({ pickCount: 2, requestedLegs: 6 }), "shortfall");
  assert.equal(resolveCoachOutcome({ pickCount: 0, requestedLegs: 6 }), "empty");
  assert.equal(resolveCoachOutcome({ pickCount: 0, requestedLegs: 6, failed: true }), "failed");
});

test("absolute terminal arm fires once then clears", async () => {
  const session = createCoachSession(1, 6, Date.now() - 44_500);
  let fired = 0;
  armCoachAbsoluteTerminal(session, () => {
    latchCoachSession(session, "shortfall");
    fired += 1;
  });
  assert.ok(session.absoluteTimer);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(fired, 1);
  assert.equal(session.absoluteTimer, null);
  assert.equal(coachSessionShouldKeepBusy(session), false);
});
