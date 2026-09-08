import assert from "node:assert/strict";
import test from "node:test";
import { coachCorrelationTimeoutMayFinalize } from "./coachCorrelationTimeout.ts";

test("correlation timeout waits for board scan to finish", () => {
  assert.equal(
    coachCorrelationTimeoutMayFinalize({
      scan: { scanComplete: false },
      boardScanInFlight: true,
      pendingScanCompletions: 0,
    }),
    false,
  );
  assert.equal(
    coachCorrelationTimeoutMayFinalize({
      scan: { scanComplete: true },
      boardScanInFlight: false,
      pendingScanCompletions: 0,
    }),
    true,
  );
  assert.equal(
    coachCorrelationTimeoutMayFinalize({
      scan: { scanComplete: true },
      boardScanInFlight: false,
      pendingScanCompletions: 1,
    }),
    false,
  );
  assert.equal(
    coachCorrelationTimeoutMayFinalize({
      scan: null,
      boardScanInFlight: false,
      pendingScanCompletions: 0,
    }),
    false,
  );
});
