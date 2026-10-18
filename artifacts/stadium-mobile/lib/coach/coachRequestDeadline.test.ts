import assert from "node:assert/strict";
import { test } from "node:test";

import { coachAbsoluteBudgetMs, coachPropLoadFailsafeMs } from "./session.ts";
import {
  armDeadlineAbort,
  coachMayApplyLateBuildResult,
  coachPastRequestDeadline,
  coachPhaseBudgetMs,
  coachRemainingBudgetMs,
  coachTimeoutRootCause,
  coachTotalRequestBudgetMs,
  createCoachRequestTiming,
  finalizeCoachRequestTiming,
  markCoachPhase,
  markCoachPending,
} from "./coachRequestDeadline.ts";

test("total request budget equals absolute (load inside same window)", () => {
  assert.equal(coachTotalRequestBudgetMs(6), 90_000);
  assert.equal(coachTotalRequestBudgetMs(6), coachAbsoluteBudgetMs(6));
  assert.equal(coachPropLoadFailsafeMs(6), coachAbsoluteBudgetMs(6));
  assert.ok(coachPropLoadFailsafeMs(6) < 105_000);
});

test("remaining budget shrinks monotonically; never resets", () => {
  const started = 1_000_000;
  const budget = 90_000;
  assert.equal(coachRemainingBudgetMs(started, budget, started + 10_000), 80_000);
  assert.equal(coachRemainingBudgetMs(started, budget, started + 90_000), 0);
  assert.equal(coachRemainingBudgetMs(started, budget, started + 120_000), 0);
  assert.equal(coachPastRequestDeadline(started, budget, started + 90_000), true);
});

test("slow load consumes total budget — scan remaining is reduced", () => {
  const started = 0;
  const budget = coachTotalRequestBudgetMs(6);
  const loadMs = 70_000;
  const remainingAfterLoad = coachRemainingBudgetMs(started, budget, loadMs);
  assert.equal(remainingAfterLoad, 20_000);
  const scanBudget = coachPhaseBudgetMs({
    remainingMs: remainingAfterLoad,
    phase: "scan",
  });
  assert.ok(scanBudget <= 20_000);
  assert.ok(scanBudget < budget);
});

test("phase budgets preserve finalization reserve when time allows", () => {
  const scan = coachPhaseBudgetMs({ remainingMs: 90_000, phase: "scan" });
  assert.equal(scan, 86_000);
  const fin = coachPhaseBudgetMs({ remainingMs: 3_000, phase: "finalization" });
  assert.equal(fin, 3_000);
});

test("timeout root cause is evidence-supported by phase", () => {
  const timing = createCoachRequestTiming({
    requestStartedAtMs: 0,
    budgetMs: 90_000,
  });
  markCoachPhase(timing, "load", 40_000);
  markCoachPending(timing, "scan");
  timing.timedOut = true;
  timing.timeoutReason = "scan_deadline";
  const rc = coachTimeoutRootCause(timing);
  assert.equal(rc?.rootCause, "scan_deadline");
  assert.equal(rc?.rootCauseGrade, "verified");
});

test("late response after terminalization is rejected", () => {
  assert.equal(
    coachMayApplyLateBuildResult({
      deliveryTerminalized: true,
      sendGenMatches: true,
    }),
    false,
  );
  assert.equal(
    coachMayApplyLateBuildResult({
      deliveryTerminalized: false,
      sendGenMatches: true,
    }),
    true,
  );
  assert.equal(
    coachMayApplyLateBuildResult({
      deliveryTerminalized: false,
      sendGenMatches: false,
    }),
    false,
  );
});

test("deadline abort fires when remaining is zero", async () => {
  const parent = new AbortController();
  const { signal, dispose } = armDeadlineAbort({
    parent: parent.signal,
    remainingMs: 0,
  });
  assert.equal(signal.aborted, true);
  dispose();
});

test("deadline abort respects parent cancel", async () => {
  const parent = new AbortController();
  const { signal, dispose } = armDeadlineAbort({
    parent: parent.signal,
    remainingMs: 60_000,
  });
  assert.equal(signal.aborted, false);
  parent.abort();
  assert.equal(signal.aborted, true);
  dispose();
});

test("finalizeCoachRequestTiming records totalMs", () => {
  const timing = createCoachRequestTiming({
    requestStartedAtMs: 1000,
    budgetMs: 90_000,
  });
  markCoachPhase(timing, "load", 5_000);
  markCoachPhase(timing, "scan", 12_000);
  finalizeCoachRequestTiming(timing, 20_000);
  assert.equal(timing.totalMs, 19_000);
  assert.equal(timing.lastCompletedPhase, "terminal");
  assert.equal(timing.loadMs, 5_000);
  assert.equal(timing.scanMs, 12_000);
});

test("6-leg previously ~180s: load+full-scan no longer fits after fix contract", () => {
  // Before: load ~90s + reset + scan 90s ≈ 180s.
  // After: single 90s window — load 90s leaves 0 for scan.
  const budget = coachTotalRequestBudgetMs(6);
  assert.equal(budget, 90_000);
  assert.equal(coachRemainingBudgetMs(0, budget, 90_000), 0);
  assert.ok(90_000 + 90_000 > budget);
});
