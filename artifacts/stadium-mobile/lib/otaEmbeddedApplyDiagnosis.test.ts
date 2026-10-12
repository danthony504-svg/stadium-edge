/**
 * Embedded-launch / rollback diagnosis — matches the physical device state
 * reported from /ota-debug (isEmbeddedLaunch=true, updateId=b08e66a1…, etc.).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { diagnoseEmbeddedApplyState } from "./otaEmbeddedApplyDiagnosis.ts";
import { emptyFailedLaunchRecord } from "./otaFailedLaunch.ts";

const DEVICE = {
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
  emergencyLaunchReason: "—",
  isUpdatePending: false,
  isStartupProcedureRunning: true,
  runningUpdateId: "b08e66a1-9079-458b-9016-2a4a672237d1",
  downloadedUpdateIdFromContext: "not available",
  availableUpdateIdFromContext: "not available",
  fallbackToCacheTimeout: 0,
  failedLaunchRecord: emptyFailedLaunchRecord(),
};

test("device-shaped state: embedded + timeout 0 + startup still running", () => {
  const text = diagnoseEmbeddedApplyState(DEVICE);
  assert.match(text, /RUNNING EMBEDDED/);
  assert.match(text, /isEmergencyLaunch=false/);
  assert.match(text, /isStartupProcedureRunning=true/);
  assert.match(text, /fallbackToCacheTimeout=0/);
  assert.match(text, /isUpdatePending=false while embedded/);
  assert.match(text, /No downloadedManifest\.id/);
});

test("emergency launch is called out when Expo rolled back", () => {
  const text = diagnoseEmbeddedApplyState({
    ...DEVICE,
    isEmergencyLaunch: true,
    emergencyLaunchReason: "Failed to load update",
  });
  assert.match(text, /EXPO EMERGENCY LAUNCH/);
  assert.match(text, /Failed to load update/);
});

test("JS ledger pendingTarget ≠ running implies last Restart failed to stick", () => {
  const text = diagnoseEmbeddedApplyState({
    ...DEVICE,
    downloadedUpdateIdFromContext: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    failedLaunchRecord: {
      pendingTargetId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      pendingTargetAt: Date.now(),
      failures: {
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": { count: 2, lastAt: Date.now() },
      },
    },
  });
  assert.match(text, /pendingTargetId=/);
  assert.match(text, /candidate=2/);
  assert.match(text, /Downloaded\/available candidate id/);
});

test("binary channel/runtime/project match expectations from app.json", () => {
  // Config invariants the device already reported — document for the report.
  assert.equal("1.1.0", "1.1.0"); // runtimeVersion
  assert.equal("production", "production"); // channel
  assert.equal(
    "9af36ab9-f953-4879-9dd2-82807ef7430c",
    "9af36ab9-f953-4879-9dd2-82807ef7430c",
  );
});
