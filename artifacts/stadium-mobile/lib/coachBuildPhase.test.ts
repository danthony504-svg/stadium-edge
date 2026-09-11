import assert from "node:assert/strict";
import test from "node:test";

import {
  coachPhaseWhileAwaitingTicketCards,
  emptyCardBoardScanStallMs,
  shouldClearBusyAfterFailedStallPaint,
  shouldKeepBusyForIncompleteBoardScan,
} from "./coachBuildPhase.ts";

test("empty cards + stash picks stay on board-scan (not stream/score grade limbo)", () => {
  assert.equal(
    coachPhaseWhileAwaitingTicketCards({
      displayedPickCount: 0,
      stashPickCount: 6,
    }),
    "board-scan",
  );
  assert.equal(
    coachPhaseWhileAwaitingTicketCards({
      displayedPickCount: 0,
      stashPickCount: 2,
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

test("stall clears busy when cards empty — unless incomplete scan still in flight", () => {
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: true,
      displayedPickCountAfter: 0,
    }),
    true,
  );
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: false,
      displayedPickCountAfter: 0,
    }),
    true,
  );
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: true,
      displayedPickCountAfter: 6,
    }),
    false,
  );
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: false,
      displayedPickCountAfter: 0,
      incompleteScanInFlight: true,
    }),
    false,
  );
});

test("empty-card stall covers board-scan budget for 6-leg asks", () => {
  // Must exceed boardScanBudgetMs(6)=120s so late/kernel scans can finish.
  assert.equal(emptyCardBoardScanStallMs(6), 150_000);
  assert.ok(emptyCardBoardScanStallMs(6) > 120_000);
  assert.ok(emptyCardBoardScanStallMs(6) < 240_000);
  assert.equal(emptyCardBoardScanStallMs(3), 120_000);
});

test("keep busy after send finally while incomplete scan has stash and no cards", () => {
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 6,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: true,
    }),
    true,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 6,
      displayedPickCount: 0,
      scanComplete: true,
      hasScanStash: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 6,
      displayedPickCount: 6,
      scanComplete: false,
      hasScanStash: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepBusyForIncompleteBoardScan({
      isParlayBuild: true,
      legTarget: 6,
      displayedPickCount: 0,
      scanComplete: false,
      hasScanStash: false,
    }),
    false,
  );
});
