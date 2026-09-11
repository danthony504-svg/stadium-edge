import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanStallMsForPaintState,
  coachPhaseWhileAwaitingTicketCards,
  emptyCardBoardScanStallMs,
  shouldClearBusyAfterFailedStallPaint,
  shouldEndBoardScanAttemptAfterLateJoins,
  shouldKeepBusyForIncompleteBoardScan,
  shouldReleaseUnderCountBoardScanAtEscape,
  shouldSuppressEmptyTicketDeadEnd,
  underCountHeldBoardScanEscapeMs,
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

test("under-count held escape is far shorter than deep 240s stall", () => {
  assert.equal(underCountHeldBoardScanEscapeMs(6), 20_000);
  assert.equal(underCountHeldBoardScanEscapeMs(9), 25_000);
  assert.ok(underCountHeldBoardScanEscapeMs(6) < emptyCardBoardScanStallMs(6));
  assert.ok(underCountHeldBoardScanEscapeMs(6) < 240_000);
});

test("paint-state stall: scored stash + empty bubble uses under-count escape", () => {
  assert.equal(
    boardScanStallMsForPaintState({
      displayedPickCount: 0,
      stashPickCount: 4,
      requestedLegs: 6,
      deepStallMs: 240_000,
    }),
    20_000,
  );
  assert.equal(
    boardScanStallMsForPaintState({
      displayedPickCount: 0,
      stashPickCount: 0,
      requestedLegs: 6,
      deepStallMs: 240_000,
    }),
    emptyCardBoardScanStallMs(6),
  );
  assert.equal(
    boardScanStallMsForPaintState({
      displayedPickCount: 6,
      stashPickCount: 6,
      requestedLegs: 6,
      deepStallMs: 240_000,
    }),
    240_000,
  );
});
