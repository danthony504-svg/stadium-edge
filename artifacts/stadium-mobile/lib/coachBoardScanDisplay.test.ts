import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldBlankHeldBoardScanPickDisplay,
  shouldHoldIncompleteBoardScanPickDisplay,
} from "./coachBoardScanDisplay.ts";

test("under-count incomplete fixed-leg scans hold pick cards", () => {
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
      legTarget: 6,
      readyPickCount: 4,
    }),
    true,
  );
});

test("full count releases hold so all picks show once", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 6,
    }),
    false,
  );
});

test("scanComplete releases hold including shortfalls", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: true,
      legTarget: 6,
      readyPickCount: 5,
    }),
    false,
  );
});

test("slate preview and stall force-show never hold", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 2,
      allowIncompletePicks: true,
    }),
    false,
  );
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 6,
      readyPickCount: 2,
      forceShowIncomplete: true,
    }),
    false,
  );
});

test("sub-3-leg asks never hold", () => {
  assert.equal(
    shouldHoldIncompleteBoardScanPickDisplay({
      scanComplete: false,
      legTarget: 2,
      readyPickCount: 1,
    }),
    false,
  );
});

test("already-displayed ticket is never blanked by under-count hold", () => {
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 6,
    }),
    false,
  );
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: true,
      displayedPickCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldBlankHeldBoardScanPickDisplay({
      holdIncomplete: false,
      displayedPickCount: 0,
    }),
    false,
  );
});
