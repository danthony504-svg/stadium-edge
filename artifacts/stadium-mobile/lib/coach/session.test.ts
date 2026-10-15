import test from "node:test";
import assert from "node:assert/strict";
import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachAbsoluteBudgetMs,
  coachAssistantTerminalFlags,
  coachInFlightResultMayApply,
  coachFinalizationReserveMs,
  coachPropLoadFailsafeMs,
  coachScoringWorkBudgetMs,
  coachSessionIsTerminal,
  coachSessionMayAcceptLatePicks,
  coachSessionShouldKeepBusy,
  coachShortfallNote,
  coachTicketBadgeLegCount,
  createCoachSession,
  latchCoachSession,
  resetCoachAbsoluteClock,
  coachRequestDeadlineMs,
  resolveCoachOutcome,
} from "./session.ts";
import { coachTerminalLiveDeadlineMs } from "../coachQa/terminalInvariant.ts";
import { linkDeadlineAbort } from "./abortableDeadline.ts";

test("6-leg absolute budget is 90s (room for props + alts)", () => {
  assert.equal(coachAbsoluteBudgetMs(6), 90_000);
});

test("prop load failsafe is the same end-to-end deadline as scoring", () => {
  assert.equal(coachPropLoadFailsafeMs(4), coachAbsoluteBudgetMs(4));
  assert.equal(coachPropLoadFailsafeMs(4), 75_000);
  assert.equal(coachPropLoadFailsafeMs(6), coachAbsoluteBudgetMs(6));
  assert.equal(coachPropLoadFailsafeMs(8), coachAbsoluteBudgetMs(8));
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
  assert.match(coachShortfallNote(6, 3), /only 3/);
  assert.doesNotMatch(coachShortfallNote(6, 3), /\*\*/);
  assert.equal(coachShortfallNote(6, 6), "");
  assert.doesNotMatch(coachShortfallNote(7, 3), /every posted market/i);
  assert.doesNotMatch(coachShortfallNote(7, 3), /every market was scanned/i);
  // Absolute flush while props pending must not blame the quality bar alone
  // (phone 5→2 / 6→3 reserved-seat lie).
  assert.match(
    coachShortfallNote(5, 2, { propsPending: true }),
    /while player props were still scoring/i,
  );
  assert.doesNotMatch(
    coachShortfallNote(5, 2, { propsPending: true }),
    /cleared the AI quality bar/i,
  );
});

test("resolveCoachOutcome maps pick counts", () => {
  assert.equal(resolveCoachOutcome({ pickCount: 6, requestedLegs: 6 }), "shown");
  assert.equal(resolveCoachOutcome({ pickCount: 2, requestedLegs: 6 }), "shortfall");
  assert.equal(resolveCoachOutcome({ pickCount: 0, requestedLegs: 6 }), "empty");
  assert.equal(resolveCoachOutcome({ pickCount: 0, requestedLegs: 6, failed: true }), "failed");
});

test("coachTicketBadgeLegCount uses delivered legs; requested stays separate", () => {
  // Shortfall: asked 8, cleared 7 → badge shows 7 (not 8).
  assert.equal(
    coachTicketBadgeLegCount({ requestedLegs: 8, deliveredLegs: 7 }),
    7,
  );
  assert.equal(
    coachTicketBadgeLegCount({ requestedLegs: 6, deliveredLegs: 6 }),
    6,
  );
  // Hide when not an N-leg ask or nothing delivered.
  assert.equal(coachTicketBadgeLegCount({ requestedLegs: 2, deliveredLegs: 2 }), null);
  assert.equal(coachTicketBadgeLegCount({ requestedLegs: 8, deliveredLegs: 0 }), null);
  assert.equal(coachTicketBadgeLegCount({ deliveredLegs: 5 }), null);
});

test("8-leg scoring budget is longer than 6-leg", () => {
  assert.equal(coachAbsoluteBudgetMs(8), 110_000);
  assert.ok(coachAbsoluteBudgetMs(8) > coachAbsoluteBudgetMs(6));
});

test("finalization reserve sits inside the absolute budget (3–5s)", () => {
  const reserve = coachFinalizationReserveMs();
  assert.ok(reserve >= 3_000 && reserve <= 5_000);
  assert.equal(coachScoringWorkBudgetMs(9), coachAbsoluteBudgetMs(9) - reserve);
  assert.equal(coachAbsoluteBudgetMs(9), 110_000);
});

test("10-leg football mix budget covers props-first skill wave + games", () => {
  assert.equal(coachAbsoluteBudgetMs(10), 120_000);
});

test("a terminal session rejects a late ticket", () => {
  const session = createCoachSession(1, 8, 1_000);
  latchCoachSession(session, "empty");
  assert.equal(coachSessionShouldKeepBusy(session), false);
  assert.equal(
    coachSessionMayAcceptLatePicks(session, { latePickCount: 8, shownPickCount: 0 }),
    false,
  );
  assert.equal(session.outcome, "empty");
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
  const session = createCoachSession(1, 6, Date.now() - 89_500);
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

test("success, shortfall, empty, and failure all clear the scoring card", () => {
  for (const outcome of ["shown", "shortfall", "empty", "failed"] as const) {
    const flags = coachAssistantTerminalFlags(outcome);
    assert.equal(flags.building, false, outcome);
    assert.equal(flags.buildStatus, undefined, outcome);
  }
});

test("cancellation and deadline expiry clear loading, and the next send ignores the previous result", () => {
  const deadline = createCoachSession(1, 4, 1_000);
  latchCoachSession(deadline, "empty");
  assert.equal(coachSessionShouldKeepBusy(deadline), false);
  const deadlineFlags = coachAssistantTerminalFlags(deadline.outcome);
  assert.equal(deadlineFlags.building, false);
  assert.equal(deadlineFlags.buildStatus, undefined);

  const cancel = createCoachSession(1, 4, 1_000);
  latchCoachSession(cancel, "failed");
  const cancelFlags = coachAssistantTerminalFlags(cancel.outcome);
  assert.equal(cancelFlags.building, false);
  assert.equal(cancelFlags.buildStatus, undefined);

  beginCoachSession(deadline, { sendGen: 2, requestedLegs: 4, now: 2_000 });
  assert.equal(deadline.outcome, "open");
  assert.equal(coachInFlightResultMayApply(deadline.sendGen, 1), false);
  assert.equal(coachInFlightResultMayApply(deadline.sendGen, 2), true);

  let painted: string | null = null;
  const tryPaint = (resultSendGen: number, label: string) => {
    if (!coachInFlightResultMayApply(deadline.sendGen, resultSendGen)) return;
    painted = label;
    latchCoachSession(deadline, "shown");
  };
  tryPaint(1, "old");
  assert.equal(painted, null);
  assert.equal(deadline.outcome, "open");
  tryPaint(2, "next");
  assert.equal(painted, "next");
  assert.equal(coachAssistantTerminalFlags(deadline.outcome).building, false);
});

test("scan budget and terminal deadline are one clock", () => {
  assert.equal(coachRequestDeadlineMs(4), 75_000);
  assert.equal(coachTerminalLiveDeadlineMs(4), coachAbsoluteBudgetMs(4));
  assert.equal(coachTerminalLiveDeadlineMs(6), 90_000);
});

test("deadline abort stops the child signal and a late result is not applied", async () => {
  const parent = new AbortController();
  const session = createCoachSession(1, 4, Date.now());
  const linked = linkDeadlineAbort(parent.signal, Date.now() + 30);
  let late = "pending";
  const work = new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("late"), 200);
    linked.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve("aborted");
    });
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(linked.signal.aborted, true);
  assert.equal(await work, "aborted");
  latchCoachSession(session, "empty");
  if (!coachSessionMayAcceptLatePicks(session, { latePickCount: 4, shownPickCount: 0 })) {
    late = "dropped";
  } else {
    late = "applied";
  }
  assert.equal(late, "dropped");
  linked.dispose();
  parent.abort();
});
