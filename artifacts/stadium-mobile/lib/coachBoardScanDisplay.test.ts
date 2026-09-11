import assert from "node:assert/strict";
import test from "node:test";

import { shouldHoldIncompleteBoardScanPickDisplay } from "./coachBoardScanDisplay.ts";

test("incomplete fixed-leg scans do not hold pick cards (empty progress hang reverted)", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 2,
    }),
    false,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 5,
      readyPickCount: 3,
    }),
    false,
  );
});

test("completed / slate / sub-3 paths still never hold", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
      readyPickCount: 4,
    }),
    false,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      allowIncompletePicks: true,
    }),
    false,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 2,
      readyPickCount: 1,
    }),
    false,
  );
});
