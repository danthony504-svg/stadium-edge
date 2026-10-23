/**
 * PR-B freeze repair regressions — deadline ownership + terminalization.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  buildCoachReliabilityBody,
  resetCoachReliabilityFulfilledDedupeForTests,
} from "../coachReliabilityReporter.ts";
import {
  coachMayApplyLateBuildResult,
  coachRemainingBudgetMs,
  coachTotalRequestBudgetMs,
  createCoachRequestTiming,
  finalizeCoachRequestTiming,
  markCoachPhase,
} from "./coachRequestDeadline.ts";
import { coachAbsoluteBudgetMs, coachPropLoadFailsafeMs } from "./session.ts";

const root = dirname(fileURLToPath(import.meta.url));

test("F1: slow load reduces scan remaining; loadMs reported separately", () => {
  const budget = coachTotalRequestBudgetMs(6);
  const started = 0;
  const loadMs = 55_000;
  const remaining = coachRemainingBudgetMs(started, budget, loadMs);
  assert.equal(remaining, 35_000);
  assert.ok(remaining < budget);
  const timing = createCoachRequestTiming({ requestStartedAtMs: started, budgetMs: budget });
  markCoachPhase(timing, "load", loadMs);
  markCoachPhase(timing, "scan", 30_000);
  finalizeCoachRequestTiming(timing, loadMs + 30_000);
  assert.equal(timing.loadMs, 55_000);
  assert.equal(timing.scanMs, 30_000);
  assert.ok((timing.totalMs ?? 0) <= budget + 1);
});

test("F2: scan hang past budget → freeze body with verified scan_deadline", () => {
  resetCoachReliabilityFulfilledDedupeForTests();
  const body = buildCoachReliabilityBody({
    requestId: "greenfield-freeze-scan",
    requestedLegCount: 6,
    returnedLegCount: 2,
    timedOut: true,
    timeoutReason: "scan_deadline",
    lastCompletedPhase: "scan",
    loadMs: 20_000,
    scanMs: 70_000,
    totalMs: 90_000,
    rootCause: "scan_deadline",
    rootCauseGrade: "verified",
    realOddsAvailable: true,
    picks: [
      { game: "A @ B", market: "Spread", isProp: false, teamAbbr: "A" },
      { game: "C @ D", market: "Moneyline", isProp: false, teamAbbr: "C" },
    ],
    deliveryCommitted: false,
  });
  assert.equal(body?.scanFailureCode, "ABSOLUTE_BUDGET");
  assert.equal(body?.timeoutReason, "scan_deadline");
  assert.equal(body?.loadMs, 20_000);
  assert.equal(body?.scanMs, 70_000);
  assert.equal(body?.rootCause, "scan_deadline");
  assert.equal(body?.rootCauseGrade, "verified");
  assert.notEqual(body?.eventType, "parlay_fulfilled");
});

test("F3: partial ticket + timeout never reports deliveryCommitted success", () => {
  resetCoachReliabilityFulfilledDedupeForTests();
  const groundedLegs = Array.from({ length: 6 }, (_, i) => ({
    game: "Minnesota Vikings @ New Orleans Saints",
    market: "Moneyline",
    isProp: false as const,
    teamAbbr: i % 2 === 0 ? "MIN" : "NO",
  }));
  const assembled = buildCoachReliabilityBody({
    requestId: "greenfield-partial",
    requestedLegCount: 6,
    returnedLegCount: 6,
    deliveryCommitted: false,
    realOddsAvailable: true,
    picks: groundedLegs,
  });
  assert.equal(assembled, null);

  const committed = buildCoachReliabilityBody({
    requestId: "greenfield-committed",
    requestedLegCount: 6,
    returnedLegCount: 6,
    deliveryCommitted: true,
    realOddsAvailable: true,
    picks: groundedLegs,
  });
  assert.equal(committed?.eventType, "parlay_fulfilled");
});

test("late response after terminalization rejected", () => {
  assert.equal(
    coachMayApplyLateBuildResult({ deliveryTerminalized: true, sendGenMatches: true }),
    false,
  );
});

test("6-leg total budget is 90s — cannot accumulate load+scan to ~180s", () => {
  assert.equal(coachAbsoluteBudgetMs(6), 90_000);
  assert.equal(coachPropLoadFailsafeMs(6), 90_000);
  assert.equal(coachTotalRequestBudgetMs(6), 90_000);
  // Before: loadFailsafe 105 + reset scan 90 ≈ 195. After: single 90.
  assert.ok(105_000 + 90_000 > coachTotalRequestBudgetMs(6));
});

test("buildParlay + coach.tsx wire monotonic deadline (no clock reset)", () => {
  const buildSrc = readFileSync(join(root, "buildParlay.ts"), "utf8");
  const coachSrc = readFileSync(join(root, "../../app/(tabs)/coach.tsx"), "utf8");
  assert.match(buildSrc, /coachTotalRequestBudgetMs/);
  assert.match(buildSrc, /coachRemainingBudgetMs/);
  assert.match(buildSrc, /armDeadlineAbort/);
  assert.match(buildSrc, /deliveryTerminalized/);
  assert.match(buildSrc, /deliveryCommitted:\s*false/);
  assert.doesNotMatch(coachSrc, /resetCoachAbsoluteClock/);
  assert.match(coachSrc, /requestStartedAtMs:\s*sessionRef\.current\.startedAtMs/);
  assert.match(coachSrc, /deliveryCommitted:\s*true/);
});

test("finalization deadline exhaustion classified", () => {
  const body = buildCoachReliabilityBody({
    requestId: "greenfield-fin",
    requestedLegCount: 6,
    returnedLegCount: 0,
    timedOut: true,
    timeoutReason: "finalization_deadline",
    lastCompletedPhase: "finalization",
    loadMs: 10_000,
    scanMs: 75_000,
    finalizationMs: 5_000,
    totalMs: 90_000,
    rootCause: "finalization_deadline",
    rootCauseGrade: "verified",
    deliveryCommitted: false,
  });
  assert.equal(body?.timeoutReason, "finalization_deadline");
  assert.equal(body?.scanFailureCode, "ABSOLUTE_BUDGET");
});

test("user cancel is not freeze and not fulfilled", () => {
  const body = buildCoachReliabilityBody({
    requestId: "greenfield-cancel",
    requestedLegCount: 6,
    returnedLegCount: 3,
    cancelled: true,
    deliveryCommitted: false,
    picks: [],
  });
  assert.equal(body?.eventType, "coach_cancelled");
  assert.equal(body?.rootCause, "request_cancelled");
});

test("rejected / cancelled race: sendGen mismatch blocks late apply", () => {
  assert.equal(
    coachMayApplyLateBuildResult({
      deliveryTerminalized: false,
      sendGenMatches: false,
    }),
    false,
  );
});
