import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanDisplayReadyCount,
  canShowFixedLegBoardScanPicks,
  shouldAcceptSameRequestBoardScanTicketUpdate,
  shouldBlankHeldBoardScanPickDisplay,
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
