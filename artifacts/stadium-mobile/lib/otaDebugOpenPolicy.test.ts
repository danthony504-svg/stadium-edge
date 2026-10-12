import assert from "node:assert/strict";
import test from "node:test";

import {
  canRunLiveOtaProbe,
  LIVE_PROBE_STARTUP_WAIT_MESSAGE,
  OTA_DEBUG_IDLE_CHECK_RESULT,
} from "./otaDebugOpenPolicy.ts";

test("canRunLiveOtaProbe blocks while startup procedure is running", () => {
  assert.equal(canRunLiveOtaProbe(true), false);
  assert.equal(canRunLiveOtaProbe(false), true);
});

test("idle check result never says loading (auto-probe tell)", () => {
  assert.doesNotMatch(OTA_DEBUG_IDLE_CHECK_RESULT, /loading/i);
  assert.match(OTA_DEBUG_IDLE_CHECK_RESULT, /live OTA probe/i);
});

test("startup wait copy is fixed for the UI", () => {
  assert.equal(
    LIVE_PROBE_STARTUP_WAIT_MESSAGE,
    "Wait for startup to finish before running live probe.",
  );
});
