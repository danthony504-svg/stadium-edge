import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("under-count incomplete scans hold pick cards", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 9,
      readyPickCount: 6,
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

test("sticky: do not blank an already-shown ticket on under-count restage", () => {
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 9,
    }),
    false,
  );
});
