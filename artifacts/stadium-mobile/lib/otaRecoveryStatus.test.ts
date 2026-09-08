import assert from "node:assert/strict";
import test from "node:test";

import {
  getOtaRecoveryStatus,
  patchOtaRecoveryStatus,
  resetOtaRecoveryStatusForTests,
  subscribeOtaRecoveryStatus,
} from "./otaRecoveryStatus.ts";

test("otaRecoveryStatus patches and notifies subscribers", () => {
  resetOtaRecoveryStatusForTests();
  let ticks = 0;
  const unsub = subscribeOtaRecoveryStatus(() => {
    ticks += 1;
  });

  patchOtaRecoveryStatus({
    runningUpdateId: "01a081de-f4c6-73d1-b09e-92cc309babae",
    availableUpdateId: "01a082bd-95fd-7fdc-b8cf-e7aadbaefc43",
    fetchResult: "isNew=true",
    pending: true,
    reloadBlocked: false,
    lastOtaError: "—",
  });

  const s = getOtaRecoveryStatus();
  assert.equal(s.runningUpdateId, "01a081de-f4c6-73d1-b09e-92cc309babae");
  assert.equal(s.availableUpdateId, "01a082bd-95fd-7fdc-b8cf-e7aadbaefc43");
  assert.equal(s.pending, true);
  assert.equal(ticks, 1);
  unsub();
});
