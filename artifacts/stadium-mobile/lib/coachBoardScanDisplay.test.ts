import assert from "node:assert/strict";
import test from "node:test";

import { shouldHoldIncompleteBoardScanPickDisplay } from "./coachBoardScanDisplay.ts";

test("fixed-leg incomplete live scans hold pick cards until complete", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 2,
    }),
    true,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 5,
      readyPickCount: 3,
    }),
    true,
  );
});

test("completed scans never hold — final ticket may display including shortfalls", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
      readyPickCount: 4,
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
      readyPickCount: 1,
    }),
    false,
  );
});

test("reaching requested count releases hold even before scanComplete", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 5,
      readyPickCount: 5,
    }),
    false,
  );
});

test("stall / forceShowIncomplete releases hold so progress is not empty forever", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 5,
      readyPickCount: 3,
      forceShowIncomplete: true,
    }),
    false,
  );
});
