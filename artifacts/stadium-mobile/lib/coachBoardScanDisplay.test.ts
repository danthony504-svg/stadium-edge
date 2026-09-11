import assert from "node:assert/strict";
import test from "node:test";

import { shouldHoldIncompleteBoardScanPickDisplay } from "./coachBoardScanDisplay.ts";

test("fixed-leg incomplete live scans hold pick cards until complete", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
    }),
    true,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 5,
    }),
    true,
  );
});

test("completed scans never hold — final ticket may display including shortfalls", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
    }),
    false,
  );
});

test("slate / explicit preview may show incomplete picks", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      allowIncompletePicks: true,
    }),
    false,
  );
});

test("sub-3-leg asks still allow incomplete flashes", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 2,
    }),
    false,
  );
});
