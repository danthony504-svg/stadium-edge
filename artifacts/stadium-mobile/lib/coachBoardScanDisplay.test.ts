import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanDisplayReadyCount,
  canShowFixedLegBoardScanPicks,
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("ready count uses Math.max — gated 4 + stash 6 must not hold as 4", () => {
  assert.equal(boardScanDisplayReadyCount(4, 6), 6);
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: boardScanDisplayReadyCount(4, 6),
    }),
    false,
  );
});

test("hard gate blocks 2/3/4/5 of 6 mid-scan display", () => {
  for (const n of [2, 3, 4, 5]) {
    assert.equal(
      canShowFixedLegBoardScanPicks({
        legTarget: 6,
        pickCount: n,
        scanComplete: false,
      }),
      false,
      `must hide ${n} of 6 mid-scan`,
    );
  }
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 6,
      scanComplete: false,
    }),
    true,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 4,
      scanComplete: true,
    }),
    true,
    "completed shortfall may show",
  );
});

test("full stash fail-soft may show slightly short soft ticket (no 93% freeze)", () => {
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 5,
      scanComplete: false,
      stashPickCount: 6,
    }),
    true,
  );
  assert.equal(
    canShowFixedLegBoardScanPicks({
      legTarget: 6,
      pickCount: 4,
      scanComplete: false,
      stashPickCount: 4,
    }),
    false,
    "under-count stash must stay hidden",
  );
});

test("under-count incomplete scans hold pick cards", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 5,
    }),
    true,
  );
});

test("full count releases hold", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 6,
    }),
    false,
  );
});

test("sticky: full-count ticket is not blanked; under-count is blankable", () => {
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 2,
      legTarget: 6,
    }),
    true,
  );
});
