import test from "node:test";
import assert from "node:assert/strict";
import {
  createTicketDeliveryClock,
  resetTicketDeliveryClock,
  ticketAwaitingPropSlotsElapsedMs,
  ticketAwaitingPropSlotsMaxWaitMs,
  ticketAwaitingPropSlotsPastDeadline,
  ticketEscapeWindowMs,
  ticketIsTerminal,
  ticketNoteAwaitingPropSlots,
  ticketProgressCopy,
  ticketResolvePhase,
  ticketShouldArmEscapeDeadline,
  ticketShouldEscapeUnderCount,
  ticketShouldForcePropSlotHardTerminal,
  ticketShouldArmPropSlotHardTerminal,
  ticketShouldKeepBusy,
  ticketShouldReArmStallPoke,
  ticketShouldSuppressEmptyDeadEnd,
  ticketStashForTerminalPaint,
} from "./ticketDelivery.ts";

test("reserved 0-prop preview cannot escape before prop-slot deadline", () => {
  assert.equal(
    ticketShouldEscapeUnderCount({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      waitElapsedMs: 0,
      requestedLegs: 6,
    }),
    false,
  );
});

test("reserved preview escapes after prop-slot deadline (honest shortfall)", () => {
  assert.equal(
    ticketShouldEscapeUnderCount({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      waitElapsedMs: ticketAwaitingPropSlotsMaxWaitMs(6),
      requestedLegs: 6,
    }),
    true,
  );
});

test("scanComplete always allows escape", () => {
  assert.equal(
    ticketShouldEscapeUnderCount({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: true,
      waitElapsedMs: 0,
      requestedLegs: 6,
    }),
    true,
  );
});

test("arm escape deadline even while awaiting props", () => {
  assert.equal(
    ticketShouldArmEscapeDeadline({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
    }),
    true,
  );
});

test("clock notes and clears awaiting-prop wait", () => {
  const clock = createTicketDeliveryClock(1_000);
  ticketNoteAwaitingPropSlots({
    clock,
    awaitingPropSlots: true,
    stashPropCount: 0,
    now: 1_500,
  });
  assert.equal(clock.awaitingPropSlotsStartedAtMs, 1_500);
  assert.equal(ticketAwaitingPropSlotsElapsedMs(clock, 2_000), 500);
  ticketNoteAwaitingPropSlots({
    clock,
    awaitingPropSlots: false,
    stashPropCount: 2,
    now: 2_100,
  });
  assert.equal(clock.awaitingPropSlotsStartedAtMs, null);
  resetTicketDeliveryClock(clock, 3_000);
  assert.equal(clock.sendStartedAtMs, 3_000);
  assert.equal(clock.awaitingPropSlotsStartedAtMs, null);
});

test("keep-busy drops past prop-slot deadline", () => {
  assert.equal(
    ticketShouldKeepBusy({
      isParlayBuild: true,
      legTarget: 6,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      awaitingPropSlotsPastDeadline: true,
    }),
    false,
  );
});

test("empty dead-end not suppressed past prop-slot deadline", () => {
  assert.equal(
    ticketShouldSuppressEmptyDeadEnd({
      boardScanPending: true,
      scanComplete: false,
      hasScanStash: true,
      awaitingPropSlotsPastDeadline: true,
    }),
    false,
  );
});

test("stall poke does not re-arm forever past deadline", () => {
  assert.equal(
    ticketShouldReArmStallPoke({
      displayedPickCount: 0,
      awaitingPropSlotsPastDeadline: true,
    }),
    false,
  );
  assert.equal(
    ticketShouldReArmStallPoke({
      displayedPickCount: 0,
      absoluteStallBudgetExhausted: true,
    }),
    false,
  );
});

test("terminal paint strips awaitingPropSlots past deadline", () => {
  const stash = {
    picks: [{ isProp: false }, { isProp: false }, { isProp: false }],
    awaitingPropSlots: true as boolean | undefined,
    scanComplete: false as boolean | undefined,
  };
  const stripped = ticketStashForTerminalPaint(stash, {
    pastPropSlotDeadline: true,
  });
  assert.equal(stripped.awaitingPropSlots, undefined);
  assert.equal(stripped.picks.length, 3);
});

test("progress copy is honest while awaiting props", () => {
  assert.match(
    ticketProgressCopy({
      scoredLegCount: 3,
      requestedLegs: 6,
      awaitingPropSlots: true,
      stashPropCount: 0,
    }) ?? "",
    /player props/i,
  );
});

test("phase resolves to awaiting-props for reserved preview", () => {
  assert.equal(
    ticketResolvePhase({
      displayedPickCount: 0,
      stashPickCount: 3,
      stashPropCount: 0,
      awaitingPropSlots: true,
      scanComplete: false,
      boardScanPending: true,
    }),
    "awaiting-props",
  );
  assert.equal(ticketIsTerminal("awaiting-props"), false);
  assert.equal(ticketIsTerminal("shown-mixed"), true);
});

test("escape window for reserved preview uses prop-slot max wait", () => {
  assert.equal(
    ticketEscapeWindowMs({
      requestedLegs: 6,
      stashPropCount: 0,
      awaitingPropSlots: true,
      scanComplete: false,
    }),
    ticketAwaitingPropSlotsMaxWaitMs(6),
  );
});

test("past-deadline helper", () => {
  assert.equal(
    ticketAwaitingPropSlotsPastDeadline({
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      requestedLegs: 6,
      waitElapsedMs: ticketAwaitingPropSlotsMaxWaitMs(6),
    }),
    true,
  );
});


test("hard terminal forces reserved preview after prop-slot wait", () => {
  assert.equal(
    ticketShouldForcePropSlotHardTerminal({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      waitElapsedMs: ticketAwaitingPropSlotsMaxWaitMs(6),
      requestedLegs: 6,
    }),
    true,
  );
  assert.equal(
    ticketShouldForcePropSlotHardTerminal({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      waitElapsedMs: 0,
      requestedLegs: 6,
    }),
    false,
  );
  assert.equal(
    ticketShouldForcePropSlotHardTerminal({
      stashPickCount: 3,
      displayedPickCount: 3,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      waitElapsedMs: ticketAwaitingPropSlotsMaxWaitMs(6),
      requestedLegs: 6,
    }),
    false,
  );
});

test("hard terminal arms only for reserved 0-prop previews", () => {
  assert.equal(
    ticketShouldArmPropSlotHardTerminal({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    ticketShouldArmPropSlotHardTerminal({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 2,
      scanComplete: false,
    }),
    false,
  );
  assert.equal(
    ticketShouldArmPropSlotHardTerminal({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: true,
    }),
    false,
  );
});

test("6-leg prop-slot UI wait is shorter than prior 60s limbo", () => {
  assert.equal(ticketAwaitingPropSlotsMaxWaitMs(6), 25_000);
  assert.ok(ticketAwaitingPropSlotsMaxWaitMs(6) < 60_000);
});
