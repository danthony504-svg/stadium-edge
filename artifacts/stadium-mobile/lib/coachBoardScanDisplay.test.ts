import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanDisplayProgressPct,
  boardScanDisplayReadyCount,
  boardScanSoftProgressLegCount,
  canCompleteFixedLegBoardScanHandoff,
  canShowFixedLegBoardScanPicks,
  isPermanentBoardScan93PctState,
  shouldAcceptSameRequestBoardScanTicketUpdate,
  shouldBlankHeldBoardScanPickDisplay,
  shouldBlockPostFreezeTicketDisplayMutation,
  shouldFreezeDisplayedCoachTicket,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("boardScanSoftProgressLegCount never claims N of N on empty staged ticket", () => {
  assert.equal(boardScanSoftProgressLegCount(0, 6), 0);
  assert.equal(boardScanSoftProgressLegCount(1, 6), 1);
  assert.equal(boardScanSoftProgressLegCount(5, 6), 5);
  assert.equal(boardScanSoftProgressLegCount(6, 6), 5);
  assert.equal(boardScanSoftProgressLegCount(40, 6), 5);
  assert.equal(boardScanSoftProgressLegCount(3, 2), 2);
});

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
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 6,
    }),
    false,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 6,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
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
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
      incomingPickCount: 4,
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

test("scored N of N releases hold and paints without waiting on scanComplete", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 6,
    }),
    false,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 6,
      scanComplete: false,
      stashPickCount: 6,
    }),
    true,
  );
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: false,
      displayedPickCount: 6,
      legTarget: 6,
    }),
    true,
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

test("scored N of N → 100% → final ticket (no scanComplete wait)", () => {
  const legTarget = 6;
  assert.equal(
    canCompleteFixedLegBoardScanHandoff({
      legTarget,
      scoredLegCount: 6,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget,
      scoredLegCount: 6,
      displayedLegCount: 0,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    boardScanDisplayProgressPct({
      displayedLegCount: 0,
      scoredLegCount: 6,
      legTarget,
    }),
    93,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
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
    isPermanentBoardScan93PctState({
      legTarget,
      scoredLegCount: 6,
      displayedLegCount: 6,
      scanComplete: false,
    }),
    false,
  );
});

test("scored N of N → scanComplete → 100% → final ticket", () => {
  const legTarget = 6;
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
    boardScanDisplayProgressPct({
      displayedLegCount: 6,
      scoredLegCount: 6,
      legTarget,
    }),
    100,
  );
});

test("no permanent 93% state after scored N of N handoff", () => {
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: 0,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    isPermanentBoardScan93PctState({
      legTarget: 6,
      scoredLegCount: 6,
      displayedLegCount: 6,
      scanComplete: false,
    }),
    false,
  );
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
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 6,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
});

test("Try Again / new request still creates a fresh ticket", () => {
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
      scanComplete: false,
    }),
    true,
  );
});


test("forceShowIncomplete accepts under-count paint (escape must not fake-succeed empty)", () => {
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
      incomingPickCount: 4,
      legTarget: 6,
      forceShowIncomplete: true,
    }),
    true,
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
      incomingPickCount: 4,
      legTarget: 6,
    }),
    false,
    "without forceShow, under-count must stay held",
  );
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 0,
      incomingScanComplete: false,
      incomingPickCount: 0,
      legTarget: 6,
      forceShowIncomplete: true,
    }),
    false,
    "forceShow with zero incoming picks still rejects",
  );
});

test("forceShowIncomplete does not reshape a frozen finished on-screen ticket", () => {
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 6,
      incomingScanComplete: false,
      incomingPickCount: 4,
      legTarget: 6,
      forceShowIncomplete: true,
    }),
    false,
  );
});


test("mid-scan N-of-N with 0 props does not freeze (prop waves must still land)", () => {
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: false,
      displayedPickCount: 6,
      legTarget: 6,
      displayedPropCount: 0,
    }),
    false,
  );
  assert.equal(
    shouldFreezeDisplayedCoachTicket({
      displayedScanComplete: false,
      displayedPickCount: 6,
      legTarget: 6,
      displayedPropCount: 3,
    }),
    true,
  );
});

test("prop-mix upgrade accepts later prop waves over game-line-only ticket", () => {
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: false,
      displayedPickCount: 5,
      incomingScanComplete: false,
      incomingPickCount: 6,
      legTarget: 6,
      displayedPropCount: 0,
      incomingPropCount: 3,
    }),
    true,
  );
  // Frozen full-count game-line ticket still upgrades when props arrive.
  assert.equal(
    shouldAcceptSameRequestBoardScanTicketUpdate({
      displayedScanComplete: true,
      displayedPickCount: 6,
      incomingScanComplete: true,
      incomingPickCount: 6,
      legTarget: 6,
      displayedPropCount: 0,
      incomingPropCount: 3,
      forceShowIncomplete: true,
    }),
    true,
  );
});
