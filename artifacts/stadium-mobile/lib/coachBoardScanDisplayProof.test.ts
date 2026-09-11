import assert from "node:assert/strict";
import test from "node:test";

import {
  boardScanDisplayReadyCount,
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("9-leg: ready=9 releases hold; gated-short stash-full uses max ready", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 9,
      readyPickCount: boardScanDisplayReadyCount(4, 9),
    }),
    false,
  );
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 9,
    }),
    false,
  );
});
