/**
 * Proof: hold until complete; sticky if shown; football mix covered separately.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("6-leg: ready=6 still held until scanComplete so football can finish scoring", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 6,
    }),
    true,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
      readyPickCount: 6,
    }),
    false,
  );
});

test("sticky: incomplete restage does not blank an already-shown ticket", () => {
  const hold = shouldHoldIncompleteBoardScanPickDisplay({
    scanComplete: false,
    legTarget: 6,
    readyPickCount: 4,
  });
  assert.equal(hold, true);
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: hold,
      displayedPickCount: 6,
    }),
    false,
  );
});
