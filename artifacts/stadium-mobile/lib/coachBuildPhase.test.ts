import assert from "node:assert/strict";
import test from "node:test";

import {
  coachPhaseWhileAwaitingTicketCards,
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

test("stall force-show that still leaves empty cards should clear busy", () => {
  assert.equal(
    shouldClearBusyAfterFailedStallPaint({
      hadStashPicks: true,
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
    }),
    false,
  );
});
