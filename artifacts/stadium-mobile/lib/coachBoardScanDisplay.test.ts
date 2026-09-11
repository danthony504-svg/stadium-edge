import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanDisplayProgressPct,
  boardScanDisplayReadyCount,
  canCompleteFixedLegBoardScanHandoff,
  canShowFixedLegBoardScanPicks,
  isPermanentBoardScan93PctState,
  shouldAcceptSameRequestBoardScanTicketUpdate,
  shouldBlankHeldBoardScanPickDisplay,
  shouldBlockPostFreezeTicketDisplayMutation,
  shouldFreezeDisplayedCoachTicket,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("partial 2 → partial 4 → final 6: only final 6 can show", () => {
  for (const n of [2, 4]) {
    assert.equal(
      shouldHoldIncompleteBoardScanPickDisplay({
        scanComplete: false,
        legTarget: 6,
        readyPickCount: n,
      }),
      true,
    );
    assert.equal(
      canShowFixedLegBoardScanPicks({
        legTarget: 6,
        pickCount: n,
        scanComplete: false,
      }),
      false,
    );
    assert.equal(
      shouldAcceptSameRequestBoardScanTicketUpdate({
        displayedScanComplete: false,
        displayedPickCount: 0,
        incomingScanComplete: false,
        incomingPickCount: n,
        legTarget: 6,
      }),
      false,
    );
  }
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
      readyPickCount: 6,
    }),
    false,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 6,
      scanComplete: true,
    }),
    true,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
});

test("final 6 → late partial 5: final 6 stays unchanged", () => {
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: true,
      displayedPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 6,
      incomingScanComplete: false,
      incomingPickCount: 5,
      legTarget: 6,
    }),
    false,
  );
});

test("final 6 → duplicate final 6: no replacement", () => {
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 6,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
});

test("final 6 → new request incomplete cannot attach (accept only for empty new bubble)", () => {
  // New request starts with empty display — incomplete still rejected; only complete lands.
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
});

test("completed shortfall 5-of-6 stable only after scanComplete", () => {
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 5,
      scanComplete: false,
    }),
    false,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 5,
      scanComplete: true,
    }),
    true,
  );
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: true,
      displayedPickCount: 5,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 5,
      incomingScanComplete: false,
      incomingPickCount: 4,
      legTarget: 6,
    }),
    false,
  );
});

test("ready count still uses Math.max for progress scoring", () => {
  assert.equal(boardScanDisplayReadyCount(4, 6), 6);
});

test("mid-scan full stash no longer paints as final", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 6,
    }),
    true,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 6,
      scanComplete: false,
      stashPickCount: 6,
    }),
    false,
  );
});

test("frozen completed ticket is not blanked while holding later waves", () => {
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 6,
      legTarget: 6,
      displayedScanComplete: true,
    }),
    false,
  );
});

test("scored N of N → scanComplete → 100% → final ticket", () => {
  const legTarget = 6;
  // Mid-scan full score: hold cards, progress capped at 93%, handoff not ready.
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget,
      readyPickCount: 6,
    }),
    true,
  );
  assert.equal(
    canCompleteFixedLegBoardScanHandoff({
      legTarget,
      scoredLegCount: 6,
      scanComplete: false,
    }),
    false,
  );
  assert.equal(
    boardScanDisplayProgressPct({
      displayedLegCount: 0,
      scoredLegCount: 6,
      legTarget,
    }),
    93,
  );
  // scanComplete: handoff opens, cards may show, progress → 100%.
  assert.equal(
    canCompleteFixedLegBoardScanHandoff({
      legTarget,
      scoredLegCount: 6,
      scanComplete: true,
    }),
    true,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget,
      pickCount: 6,
      scanComplete: true,
    }),
    true,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget,
    }),
    true,
  );
  assert.equal(
    boardScanDisplayProgressPct({
      displayedLegCount: 6,
      scoredLegCount: 6,
      legTarget,
    }),
    100,
  );
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: true,
      displayedPickCount: 6,
      legTarget,
    }),
    true,
  );
});

test("no permanent 93% state after scored N of N + scanComplete handoff", () => {
  // Temporary wait while scanning is OK.
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: 0,
      scanComplete: false,
    }),
    false,
  );
  // Bug: finished scan + full score + no cards.
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: 0,
      scanComplete: true,
    }),
    true,
  );
  // After handoff paints the ticket, not permanent.
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: 6,
      scanComplete: true,
    }),
    false,
  );
  // Handoff accept + show clears the permanent state.
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
  // Frozen empty may still accept completed non-empty recovery (no permanent empty/93%).
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 0,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
});

test("post-freeze rescoring cannot mutate the visible finished ticket", () => {
  assert.equal(
    shouldBlockPostFreezeTicketDisplayMutation({
      frozen: true,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    shouldBlockPostFreezeTicketDisplayMutation({
      frozen: false,
      legTarget: 6,
    }),
    false,
  );
  assert.equal(
    shouldBlockPostFreezeTicketDisplayMutation({
      frozen: true,
      legTarget: 2,
    }),
    false,
  );
  // Frozen visible ticket rejects late sim-shaped replacements too.
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 6,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
});

test("Try Again / new request still creates a fresh ticket", () => {
  // Prior request frozen; new request clears freeze (displayedScanComplete false).
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    shouldBlockPostFreezeTicketDisplayMutation({
      frozen: false,
      legTarget: 6,
    }),
    false,
  );
  assert.equal(
    canCompleteFixedLegBoardScanHandoff({
      legTarget: 8,
      scoredLegCount: 8,
      scanComplete: true,
    }),
    true,
  );
});
