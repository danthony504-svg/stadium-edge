import test from "node:test";
import assert from "node:assert/strict";
import {
  beginTicketDeliverySession,
  createTicketDeliverySession,
  latchTicketDeliveryTerminal,
  ticketAbsoluteUiBudgetMs,
  ticketDeliveryAbsolutePastDeadline,
  ticketDeliveryArmHardTerminal,
  ticketDeliveryNotePartial,
  ticketDeliveryShouldArmHardTerminal,
  ticketDeliveryShouldHoldIncompletePicks,
  ticketDeliveryShouldKeepBusy,
  ticketDeliveryStashForPaint,
  ticketDeliveryResolvePhase,
} from "./ticketDeliverySession.ts";
import { ticketAwaitingPropSlotsMaxWaitMs } from "./ticketDelivery.ts";

test("absolute UI budget for 6-leg is 45s (below scanner prop hang)", () => {
  assert.equal(ticketAbsoluteUiBudgetMs(6), 45_000);
  assert.ok(ticketAbsoluteUiBudgetMs(6) < 120_000);
});

test("keepBusy drops after absolute budget even if boardScanPending", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  assert.equal(
    ticketDeliveryShouldKeepBusy(session, {
      isParlayBuild: true,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      awaitingPropSlots: true,
      stashPropCount: 0,
      now: 1_000 + ticketAbsoluteUiBudgetMs(6),
    }),
    false,
  );
});

test("keepBusy drops after prop-slot deadline even if boardScanPending", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  ticketDeliveryNotePartial(session, {
    awaitingPropSlots: true,
    stashPropCount: 0,
    now: 1_500,
  });
  assert.equal(
    ticketDeliveryShouldKeepBusy(session, {
      isParlayBuild: true,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      awaitingPropSlots: true,
      stashPropCount: 0,
      now: 1_500 + ticketAwaitingPropSlotsMaxWaitMs(6),
    }),
    false,
  );
});

test("terminal latch permanently blocks keepBusy re-arm", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  ticketDeliveryNotePartial(session, {
    awaitingPropSlots: true,
    stashPropCount: 0,
    now: 1_200,
  });
  latchTicketDeliveryTerminal(session, "shown-shortfall", 2_000);
  // Even with a fresh-looking awaiting stash + pending scan + early now:
  assert.equal(
    ticketDeliveryShouldKeepBusy(session, {
      isParlayBuild: true,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      awaitingPropSlots: true,
      stashPropCount: 0,
      now: 2_100,
    }),
    false,
  );
  // And hold opens:
  assert.equal(
    ticketDeliveryShouldHoldIncompletePicks(session, {
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 3,
      awaitingPropSlots: true,
      stashPropCount: 0,
      now: 2_100,
    }),
    false,
  );
});

test("notePartial after terminal does not re-stamp awaiting clock", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  ticketDeliveryNotePartial(session, {
    awaitingPropSlots: true,
    stashPropCount: 0,
    now: 1_200,
  });
  assert.equal(session.clock.awaitingPropSlotsStartedAtMs, 1_200);
  latchTicketDeliveryTerminal(session, "shown-shortfall", 2_000);
  // Would clear clock if notePartial still ran the clear path with false —
  // terminal note is a no-op so clock stays frozen.
  ticketDeliveryNotePartial(session, {
    awaitingPropSlots: false,
    stashPropCount: 2,
    now: 3_000,
  });
  assert.equal(session.clock.awaitingPropSlotsStartedAtMs, 1_200);
});

test("stashForPaint strips awaitingPropSlots past absolute budget", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  const stash = {
    picks: [1, 2, 3],
    awaitingPropSlots: true as boolean | undefined,
    scanComplete: false as boolean | undefined,
  };
  assert.equal(
    ticketDeliveryAbsolutePastDeadline(
      session,
      1_000 + ticketAbsoluteUiBudgetMs(6),
    ),
    true,
  );
  const painted = ticketDeliveryStashForPaint(session, stash, {
    stashPropCount: 0,
    now: 1_000 + ticketAbsoluteUiBudgetMs(6),
  });
  assert.equal(painted.awaitingPropSlots, undefined);
  assert.equal(painted.picks.length, 3);
});

test("hard terminal arms once for reserved 0-prop preview", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  ticketDeliveryNotePartial(session, {
    awaitingPropSlots: true,
    stashPropCount: 0,
    now: 1_100,
  });
  assert.equal(
    ticketDeliveryShouldArmHardTerminal(session, {
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
    }),
    true,
  );
  let fired = 0;
  assert.equal(
    ticketDeliveryArmHardTerminal(session, {
      onFire: () => {
        fired += 1;
      },
      now: 1_100,
    }),
    true,
  );
  // Second arm is a no-op while timer is live.
  assert.equal(
    ticketDeliveryShouldArmHardTerminal(session, {
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
    }),
    false,
  );
  clearTimeout(session.hardTerminalTimer!);
  session.hardTerminalTimer = null;
  assert.equal(fired, 0);
});

test("resolvePhase drops awaiting-props after absolute budget", () => {
  const now = Date.now();
  const session = createTicketDeliverySession(1, 6, now);
  ticketDeliveryNotePartial(session, {
    awaitingPropSlots: true,
    stashPropCount: 0,
    now,
  });
  assert.equal(
    ticketDeliveryResolvePhase(session, {
      displayedPickCount: 0,
      stashPickCount: 3,
      stashPropCount: 0,
      awaitingPropSlots: true,
      scanComplete: false,
      boardScanPending: true,
    }),
    "awaiting-props",
  );
  session.clock.sendStartedAtMs = now - ticketAbsoluteUiBudgetMs(6) - 1_000;
  assert.equal(
    ticketDeliveryResolvePhase(session, {
      displayedPickCount: 0,
      stashPickCount: 3,
      stashPropCount: 0,
      awaitingPropSlots: true,
      scanComplete: false,
      boardScanPending: true,
    }),
    "stashed-held",
  );
});

test("beginSend resets terminal latch", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  latchTicketDeliveryTerminal(session, "shown-shortfall", 2_000);
  beginTicketDeliverySession(session, { sendGen: 2, requestedLegs: 6, now: 5_000 });
  assert.equal(session.outcome, "open");
  assert.equal(session.forceShow, false);
  assert.equal(session.sendGen, 2);
});

test("latch clears absolute terminal timer so under-count cannot re-fire busy", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  let fired = 0;
  session.absoluteTerminalTimer = setTimeout(() => {
    fired += 1;
  }, 60_000);
  latchTicketDeliveryTerminal(session, "shown-mixed", 2_000);
  assert.equal(session.absoluteTerminalTimer, null);
  assert.equal(session.outcome, "shown-mixed");
  assert.equal(session.forceShow, true);
  assert.equal(fired, 0);
});

test("keepBusy is false when under-count cards are already displayed", () => {
  const session = createTicketDeliverySession(1, 6, 1_000);
  assert.equal(
    ticketDeliveryShouldKeepBusy(session, {
      isParlayBuild: true,
      displayedPickCount: 2,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      awaitingPropSlots: false,
      stashPropCount: 0,
      now: 1_500,
    }),
    false,
  );
});
