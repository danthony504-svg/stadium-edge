import assert from "node:assert/strict";
import test from "node:test";

import { coachBoardScanMayTerminalize } from "./coachTerminalGate.ts";

test("six staged picks finalized to three cannot terminalize an incomplete scan", () => {
  assert.equal(coachBoardScanMayTerminalize({
    requestedLegs: 6,
    finalizedPickCount: 3,
    scanComplete: false,
  }), false);
});

test("later finalized six-pick ticket may terminalize before scan completion", () => {
  assert.equal(coachBoardScanMayTerminalize({
    requestedLegs: 6,
    finalizedPickCount: 6,
    scanComplete: false,
  }), true);
});

test("completed board scan may terminalize with an honest three-pick shortfall", () => {
  assert.equal(coachBoardScanMayTerminalize({
    requestedLegs: 6,
    finalizedPickCount: 3,
    scanComplete: true,
  }), true);
});
