import assert from "node:assert/strict";
import { test } from "node:test";

import {
  armCoachBuildFinalizeWatchdog,
  coachBuildWasFinalized,
  COACH_BUILD_FINALIZE_WATCHDOG_MS,
  disarmCoachBuildFinalizeWatchdog,
  markCoachBuildFinalized,
  resetCoachBuildFinalization,
  shouldTerminateCoachBuildOnDeliveryGateFailure,
} from "./coachBuildFinalization.ts";

test("shouldTerminateCoachBuildOnDeliveryGateFailure only on final scan", () => {
  assert.equal(shouldTerminateCoachBuildOnDeliveryGateFailure(true, false), true);
  assert.equal(shouldTerminateCoachBuildOnDeliveryGateFailure(false, false), false);
  assert.equal(shouldTerminateCoachBuildOnDeliveryGateFailure(true, true), false);
});

test("coach build finalization is idempotent per request", () => {
  resetCoachBuildFinalization();
  assert.equal(coachBuildWasFinalized(1, "req-a"), false);
  markCoachBuildFinalized(1, "req-a");
  assert.equal(coachBuildWasFinalized(1, "req-a"), true);
  assert.equal(coachBuildWasFinalized(2, "req-a"), false);
  resetCoachBuildFinalization();
  assert.equal(coachBuildWasFinalized(1, "req-a"), false);
});

test("finalize watchdog fires once after 3 seconds", async () => {
  resetCoachBuildFinalization();
  let fires = 0;
  armCoachBuildFinalizeWatchdog(3, "req-b", () => {
    fires += 1;
    markCoachBuildFinalized(3, "req-b");
  });
  await new Promise((r) => setTimeout(r, COACH_BUILD_FINALIZE_WATCHDOG_MS - 50));
  assert.equal(fires, 0);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(fires, 1);
  armCoachBuildFinalizeWatchdog(3, "req-b", () => {
    fires += 1;
  });
  await new Promise((r) => setTimeout(r, COACH_BUILD_FINALIZE_WATCHDOG_MS + 50));
  assert.equal(fires, 1);
  disarmCoachBuildFinalizeWatchdog();
});

test("finalize watchdog does not fire after request is marked finalized", async () => {
  resetCoachBuildFinalization();
  let fires = 0;
  armCoachBuildFinalizeWatchdog(4, "req-c", () => {
    fires += 1;
  });
  markCoachBuildFinalized(4, "req-c");
  await new Promise((r) => setTimeout(r, COACH_BUILD_FINALIZE_WATCHDOG_MS + 50));
  assert.equal(fires, 0);
  disarmCoachBuildFinalizeWatchdog();
});
