import assert from "node:assert/strict";
import test from "node:test";

import { classifyOtaApplyFailure } from "./otaApplyFailureClassify.ts";

test("reconcile launched → applied_ok", () => {
  const r = classifyOtaApplyFailure({
    reconcileObserved: "launched",
    isEmbeddedLaunch: false,
    isEmergencyLaunch: false,
    runningUpdateId: "tip-new",
    lastRestartTargetId: "tip-new",
  });
  assert.equal(r.kind, "applied_ok");
});

test("reconcile failed → launch_failed", () => {
  const r = classifyOtaApplyFailure({
    reconcileObserved: "failed",
    failedTargetId: "tip-new",
    failedCount: 1,
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    runningUpdateId: "embedded-1",
    lastRestartTargetId: "tip-new",
  });
  assert.equal(r.kind, "launch_failed");
  assert.match(r.summary, /tip-new/);
});

test("emergency launch → launch_failed", () => {
  const r = classifyOtaApplyFailure({
    reconcileObserved: "no-target",
    isEmbeddedLaunch: true,
    isEmergencyLaunch: true,
    emergencyLaunchReason: "Crash",
    runningUpdateId: "embedded-1",
  });
  assert.equal(r.kind, "launch_failed");
});

test("embedded + no ledger target after claim → selection_failed", () => {
  const r = classifyOtaApplyFailure({
    reconcileObserved: null,
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    runningUpdateId: "embedded-1",
    lastRestartTargetId: null,
  });
  assert.equal(r.kind, "selection_failed");
});

test("idle embedded with explicit no-target reconcile", () => {
  const r = classifyOtaApplyFailure({
    reconcileObserved: "no-target",
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    runningUpdateId: "embedded-1",
  });
  assert.equal(r.kind, "idle_embedded");
});

test("updatePreviouslyFailed reason → launch_failed", () => {
  const r = classifyOtaApplyFailure({
    reconcileObserved: "no-target",
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    runningUpdateId: "embedded-1",
    updatePreviouslyFailedReason: true,
  });
  assert.equal(r.kind, "launch_failed");
});
