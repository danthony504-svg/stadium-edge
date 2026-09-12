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
  shouldArmUnderCountEscapeDeadline,
  shouldSuppressEmptyTicketDeadEnd,
  underCountHeldBoardScanEscapeMs,
  underCountHeldBoardScanEscapeMsForStash,
  emptyTicketDeadEndMessage,
  stallIncompleteScanStillInFlight,
  awaitingPropSlotsMaxWaitMs,
  underCountEscapeWindowMsForStash,
  shouldReArmBoardScanStallPoke,
  coachBoardScanProgressCopy,
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

test("forceShow alone does not drop keep-busy while bubble still empty", () => {
  // Escape may latch forceShow before paint succeeds — must keep busy until cards show.
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
    true,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 9,
      displayedPickCount: 4,
      scanComplete: false,
      hasScanStash: true,
      boardScanPending: true,
      forceShowIncomplete: true,
    }),
    false,
    "once cards are on screen, busy may clear",
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

test("dead-end copy only claims still-scoring while board-scan pending", () => {
  assert.match(
    emptyTicketDeadEndMessage({ boardScanPending: true, scanComplete: false }),
    /may still be scoring/i,
  );
  assert.doesNotMatch(
    emptyTicketDeadEndMessage({ boardScanPending: false, scanComplete: true }),
    /may still be scoring/i,
  );
});

test("stall incomplete stays in-flight while scan pending / scored stash incomplete", () => {
  assert.equal(
    stallIncompleteScanStillInFlight({
      forceShowIncomplete: true,
      boardScanPending: false,
      scanComplete: false,
      stashPickCount: 4,
      displayedPickCount: 0,
    }),
    true,
  );
  assert.equal(
    stallIncompleteScanStillInFlight({
      forceShowIncomplete: true,
      boardScanPending: false,
      scanComplete: false,
      stashPickCount: 4,
      displayedPickCount: 4,
    }),
    false,
  );
  // Completed shortfall must unlock — otherwise forceShow + failed paint = permanent 93%.
  assert.equal(
    stallIncompleteScanStillInFlight({
      forceShowIncomplete: true,
      boardScanPending: false,
      scanComplete: true,
      stashPickCount: 4,
      displayedPickCount: 0,
    }),
    false,
  );
});


test("game-line-only stash waits longer before under-count escape", () => {
  assert.ok(
    underCountHeldBoardScanEscapeMsForStash({
      requestedLegs: 6,
      stashPropCount: 0,
    }) >
      underCountHeldBoardScanEscapeMs(6),
  );
  assert.equal(
    underCountHeldBoardScanEscapeMsForStash({
      requestedLegs: 6,
      stashPropCount: 2,
    }),
    underCountHeldBoardScanEscapeMs(6),
  );
});


test("awaitingPropSlots blocks under-count escape until props, scan complete, or deadline", () => {
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
    }),
    false,
    "reserved 0-prop preview must not escape as a real 3-of-6 ticket",
  );
  assert.equal(
    shouldArmUnderCountEscapeDeadline({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
    }),
    true,
    "reserved preview still arms the prop-slot deadline",
  );
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 4,
      displayedPickCount: 0,
      awaitingPropSlots: false,
      stashPropCount: 2,
      scanComplete: false,
    }),
    true,
    "real under-count with props may escape",
  );
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: true,
    }),
    true,
    "completed scan may paint honest shortfall",
  );
  assert.equal(
    shouldReleaseUnderCountBoardScanAtEscape({
      stashPickCount: 3,
      displayedPickCount: 0,
      awaitingPropSlots: true,
      stashPropCount: 0,
      scanComplete: false,
      requestedLegs: 6,
      awaitingPropSlotsWaitElapsedMs: awaitingPropSlotsMaxWaitMs(6),
    }),
    true,
    "past prop-slot deadline may paint honest shortfall",
  );
});

test("stall poke does not re-arm forever past prop-slot deadline", () => {
  assert.equal(
    shouldReArmBoardScanStallPoke({
      displayedPickCount: 0,
      awaitingPropSlotsPastDeadline: true,
    }),
    false,
  );
  assert.equal(
    shouldReArmBoardScanStallPoke({
      displayedPickCount: 0,
      absoluteStallBudgetExhausted: true,
    }),
    false,
  );
  assert.equal(
    shouldReArmBoardScanStallPoke({ displayedPickCount: 0 }),
    true,
  );
});

test("progress copy is honest while awaiting prop slots", () => {
  assert.match(
    coachBoardScanProgressCopy({
      scoredLegCount: 3,
      requestedLegs: 6,
      awaitingPropSlots: true,
      stashPropCount: 0,
    }) ?? "",
    /player props/i,
  );
  assert.match(
    coachBoardScanProgressCopy({
      scoredLegCount: 4,
      requestedLegs: 6,
      awaitingPropSlots: false,
      stashPropCount: 2,
    }) ?? "",
    /Scored 4 of 6/,
  );
});

test("keep-busy drops after awaitingPropSlots deadline", () => {
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
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

test("reserved preview uses prop-slot escape window", () => {
  assert.equal(
    underCountEscapeWindowMsForStash({
      requestedLegs: 6,
      stashPropCount: 0,
      awaitingPropSlots: true,
      scanComplete: false,
    }),
    awaitingPropSlotsMaxWaitMs(6),
  );
  assert.ok(
    underCountEscapeWindowMsForStash({
      requestedLegs: 6,
      stashPropCount: 0,
      awaitingPropSlots: true,
      scanComplete: false,
    }) > underCountHeldBoardScanEscapeMs(6),
  );
});
