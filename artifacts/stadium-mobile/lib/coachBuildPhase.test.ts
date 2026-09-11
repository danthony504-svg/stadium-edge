import assert from "node:assert/strict";
import test from "node:test";

import {
  coachPhaseWhileAwaitingTicketCards,
  emptyCardBoardScanStallMs,
  shouldClearBusyAfterFailedStallPaint,
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

test("stall clears busy when cards still empty — even with empty stash", () => {
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
});

test("empty-card stall budget is shorter than deep 6+ leg hold", () => {
  assert.equal(emptyCardBoardScanStallMs(6), 90_000);
  assert.ok(emptyCardBoardScanStallMs(6) < 240_000);
  assert.equal(emptyCardBoardScanStallMs(3), 75_000);
});
