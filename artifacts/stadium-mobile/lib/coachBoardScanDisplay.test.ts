import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanDisplayReadyCount,
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("ready count uses Math.max — gated 4 + stash 6 must not hold as 4", () => {
  assert.equal(boardScanDisplayReadyCount(4, 6), 6);
  assert.equal(boardScanDisplayReadyCount(0, 6), 6);
  assert.equal(boardScanDisplayReadyCount(6, 6), 6);
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: boardScanDisplayReadyCount(4, 6),
    }),
    false,
  );
});

test("under-count incomplete scans hold pick cards", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: boardScanDisplayReadyCount(4, 4),
    }),
    true,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 5,
    }),
    true,
  );
});

test("full count releases hold so Scored N of N is not stuck at 93%", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 9,
      readyPickCount: 9,
    }),
    false,
  );
});

test("scanComplete releases hold", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 9,
      readyPickCount: 9,
    }),
    false,
  );
});

test("sticky: full-count ticket is not blanked on under-count restage", () => {
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 6,
      legTarget: 6,
    }),
    false,
  );
});

test("under-count displayed cards are blankable — no frozen 4 of 6", () => {
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 4,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 5,
      legTarget: 6,
    }),
    true,
  );
});
