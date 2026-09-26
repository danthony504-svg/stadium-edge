import test from "node:test";
import assert from "node:assert/strict";
import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachAbsoluteBudgetMs,
  coachPropLoadFailsafeMs,
  coachSessionIsTerminal,
  coachSessionMayAcceptLatePicks,
  coachSessionShouldKeepBusy,
  coachShortfallNote,
  createCoachSession,
  latchCoachSession,
  resetCoachAbsoluteClock,
  resolveCoachOutcome,
  upgradeCoachSessionOutcome,
} from "./session.ts";

test("6-leg absolute budget is 70s (room for props + alts)", () => {
  assert.equal(coachAbsoluteBudgetMs(6), 70_000);
});

test("prop load failsafe covers board prefetch without scoring", () => {
  assert.equal(coachPropLoadFailsafeMs(6), 90_000);
  assert.ok(coachPropLoadFailsafeMs(8) >= coachAbsoluteBudgetMs(8) + 15_000);
});

test("resetCoachAbsoluteClock clears timer and restarts budget window", () => {
  const session = createCoachSession(1, 6, 1_000);
  session.absoluteTimer = setTimeout(() => {}, 60_000);
  resetCoachAbsoluteClock(session, 40_000);
  assert.equal(session.startedAtMs, 40_000);
  assert.equal(session.absoluteTimer, null);
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
  assert.doesNotMatch(coachShortfallNote(7, 3), /every posted market/i);
  assert.doesNotMatch(coachShortfallNote(7, 3), /every market was scanned/i);
});

test("resolveCoachOutcome maps pick counts", () => {
  assert.equal(resolveCoachOutcome({ pickCount: 6, requestedLegs: 6 }), "shown");
  assert.equal(resolveCoachOutcome({ pickCount: 2, requestedLegs: 6 }), "shortfall");
  assert.equal(resolveCoachOutcome({ pickCount: 0, requestedLegs: 6 }), "empty");
  assert.equal(resolveCoachOutcome({ pickCount: 0, requestedLegs: 6, failed: true }), "failed");
});

test("8-leg scoring budget is longer than 6-leg", () => {
  assert.equal(coachAbsoluteBudgetMs(8), 80_000);
  assert.ok(coachAbsoluteBudgetMs(8) > coachAbsoluteBudgetMs(6));
});

test("late picks upgrade empty budget latch without re-busying", () => {
  const session = createCoachSession(1, 8, 1_000);
  latchCoachSession(session, "empty");
  assert.equal(coachSessionShouldKeepBusy(session), false);
  assert.equal(
    coachSessionMayAcceptLatePicks(session, { latePickCount: 8, shownPickCount: 0 }),
    true,
  );
  upgradeCoachSessionOutcome(session, "shown");
  assert.equal(session.outcome, "shown");
  assert.equal(coachSessionShouldKeepBusy(session), false);
  assert.equal(
    coachSessionMayAcceptLatePicks(session, { latePickCount: 8, shownPickCount: 8 }),
    false,
  );
});

test("late picks do not reopen a full shown ticket", () => {
  const session = createCoachSession(1, 6, 1_000);
  latchCoachSession(session, "shown");
  assert.equal(
    coachSessionMayAcceptLatePicks(session, { latePickCount: 6, shownPickCount: 6 }),
    false,
  );
  assert.equal(
    coachSessionMayAcceptLatePicks(session, { latePickCount: 7, shownPickCount: 6 }),
    false,
  );
});

test("absolute terminal arm fires once then clears", async () => {
  const session = createCoachSession(1, 6, Date.now() - 69_500);
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
