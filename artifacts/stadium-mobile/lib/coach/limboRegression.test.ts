/**
 * Limbo regressions the greenfield Coach must never recreate.
 * Cases from production screenshots:
 *  1) 84% "Scoring player props…" with Final unchecked forever
 *  2) 2-of-6 cards + "scan continues" + send spinner forever
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isParlayBuildAsk, resolveBuildLegTarget } from "./parseAsk.ts";
import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachAbsoluteBudgetMs,
  coachSessionShouldKeepBusy,
  coachShortfallNote,
  createCoachSession,
  latchCoachSession,
  resolveCoachOutcome,
} from "./session.ts";

test("6-leg ask resolves to board-scan build target", () => {
  assert.equal(isParlayBuildAsk("Build me a 6-leg parlay"), true);
  assert.equal(resolveBuildLegTarget("Build me a 6-leg parlay"), 6);
  assert.equal(coachAbsoluteBudgetMs(6), 70_000);
});

test("84% limbo: absolute budget latch unlocks even with zero cards", async () => {
  const session = createCoachSession(1, 6, Date.now() - 69_500);
  beginCoachSession(session, { sendGen: 1, requestedLegs: 6, now: Date.now() - 69_500 });
  assert.equal(coachSessionShouldKeepBusy(session), true);

  let unlocked = false;
  armCoachAbsoluteTerminal(session, () => {
    latchCoachSession(session, resolveCoachOutcome({ pickCount: 0, requestedLegs: 6 }));
    unlocked = true;
  });
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(unlocked, true);
  assert.equal(coachSessionShouldKeepBusy(session), false);
  assert.equal(session.outcome, "empty");
});

test("2-of-6 scan-continues limbo: shortfall latch unlocks and stays unlocked", () => {
  const session = createCoachSession(2, 6);
  beginCoachSession(session, { sendGen: 2, requestedLegs: 6 });
  // Partial cards painted while scan still "running"
  assert.equal(coachSessionShouldKeepBusy(session), true);
  const outcome = resolveCoachOutcome({ pickCount: 2, requestedLegs: 6 });
  assert.equal(outcome, "shortfall");
  latchCoachSession(session, outcome);
  assert.equal(coachSessionShouldKeepBusy(session), false);
  assert.match(coachShortfallNote(6, 2), /only \*\*2\*\*/);
  // Late "scan still pending" cannot re-busy
  assert.equal(coachSessionShouldKeepBusy(session), false);
  latchCoachSession(session, "shown"); // second latch is a no-op upgrade path
  assert.equal(session.outcome, "shortfall");
  assert.equal(coachSessionShouldKeepBusy(session), false);
});

test("shown-full ticket unlocks and does not claim shortfall", () => {
  const session = createCoachSession(3, 6);
  beginCoachSession(session, { sendGen: 3, requestedLegs: 6 });
  latchCoachSession(
    session,
    resolveCoachOutcome({ pickCount: 6, requestedLegs: 6 }),
  );
  assert.equal(session.outcome, "shown");
  assert.equal(coachShortfallNote(6, 6), "");
  assert.equal(coachSessionShouldKeepBusy(session), false);
});
