import assert from "node:assert/strict";
import test from "node:test";

import {
  coachPhaseWhileAwaitingTicketCards,
  emptyCardBoardScanStallMs,
  shouldClearBusyAfterFailedStallPaint,
  shouldEndBoardScanAttemptAfterLateJoins,
  shouldKeepBusyForIncompleteBoardScan,
  shouldReleaseUnderCountBoardScanAtEscape,
  shouldSuppressEmptyTicketDeadEnd,
} from "./coachBuildPhase.ts";

test("empty cards + stash picks stay on board-scan (not stream/score grade limbo)", () => {
  assert.equal(
    coachPhaseWhileAwaitingTicketCards({
      displayedPickCount: 0,
      stashPickCount: 6,
    }),
    "board-scan",
  );
});

test("once cards land, phase may advance to stream", () => {
  assert.equal(
    coachPhaseWhileAwaitingTicketCards({
      displayedPickCount: 6,
      stashPickCount: 6,
    }),
    "stream",
  );
});

test("stall keeps busy while board-scan pending even with empty stash", () => {
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: false,
      displayedPickCountAfter: 0,
      incompleteScanInFlight: true,
    }),
    false,
  );
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: false,
      displayedPickCountAfter: 0,
      incompleteScanInFlight: false,
    }),
    true,
  );
});

test("empty-card stall covers 9-leg board-scan budget", () => {
  assert.equal(emptyCardBoardScanStallMs(9), 180_000);
  assert.ok(emptyCardBoardScanStallMs(9) > 150_000);
  assert.equal(emptyCardBoardScanStallMs(6), 150_000);
  assert.equal(emptyCardBoardScanStallMs(5), 120_000);
});

test("keep busy for pending board-scan with empty stash (9-leg + props-only race)", () => {
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 9,
      displayedPickCount: 0,
      scanComplete: undefined,
      hasScanStash: false,
      boardScanPending: true,
    }),
    true,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 5,
      displayedPickCount: 0,
      scanComplete: undefined,
      hasScanStash: false,
      boardScanPending: true,
    }),
    true,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 9,
      displayedPickCount: 0,
      scanComplete: undefined,
      hasScanStash: false,
      boardScanPending: false,
    }),
    false,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 9,
      displayedPickCount: 0,
      scanComplete: true,
      hasScanStash: true,
      boardScanPending: true,
    }),
    false,
  );
});

test("suppress empty-ticket dead-end while board-scan pending without stash", () => {
  assert.equal(
    shouldSuppressEmptyTicketDeadEnd({
      boardScanPending: true,
      scanComplete: undefined,
      hasScanStash: false,
    }),
    true,
  );
  assert.equal(
    shouldSuppressEmptyTicketDeadEnd({
      boardScanPending: false,
      scanComplete: false,
      hasScanStash: true,
    }),
    true,
  );
  assert.equal(
    shouldSuppressEmptyTicketDeadEnd({
      boardScanPending: false,
      scanComplete: true,
      hasScanStash: true,
    }),
    false,
  );
});

test("stall/join escape releases under-count when stash has picks and bubble empty", () => {
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 7,
      displayedPickCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 7,
      displayedPickCount: 7,
    }),
    false,
  );
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 0,
      displayedPickCount: 0,
    }),
    false,
  );
});

test("late joins always end board-scan attempt ownership when drained", () => {
  assert.equal(shouldEndBoardScanAttemptAfterLateJoins({ lateJoinsRemaining: 0 }), true);
  assert.equal(shouldEndBoardScanAttemptAfterLateJoins({ lateJoinsRemaining: 2 }), false);
});

test("forceShow escape prevents keep-busy from re-locking at 93%", () => {
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 9,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      forceShowIncomplete: true,
    }),
    false,
  );
});
