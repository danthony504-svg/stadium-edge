/**
 * NCAAF P0 early-exit reliability mapping — digest-only blocked_unvalidated_market.
 * Kept free of api-server imports so node --test / strip-types can run it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mapScanFailureCode } from "./coachReliabilityClassify.ts";
import { buildCoachReliabilityBody } from "./coachReliabilityReporter.ts";

test("P0_UNVALIDATED_MARKETS maps to non-alertable blocked_unvalidated_market", () => {
  const mapped = mapScanFailureCode("P0_UNVALIDATED_MARKETS");
  assert.equal(mapped?.eventType, "parlay_zero_results");
  assert.equal(mapped?.failureReason, "blocked_unvalidated_market");
  assert.equal(mapped?.alertable, false);
});

test("NCAAF gate zero-leg report uses blocked_unvalidated_market (not zero_results)", () => {
  const body = buildCoachReliabilityBody({
    requestedLegCount: 6,
    returnedLegCount: 0,
    realOddsAvailable: null,
    requestId: "greenfield-ncaaf-p0",
    sportCategory: "ncaaf",
    picks: [],
    eventType: "parlay_zero_results",
    failureReason: "blocked_unvalidated_market",
    rootCause: "unvalidated_ncaaf_game_line_simulation",
  });
  assert.equal(body?.eventType, "parlay_zero_results");
  assert.equal(body?.failureReason, "blocked_unvalidated_market");
  assert.equal(body?.requestId, "greenfield-ncaaf-p0");
  assert.equal(body?.rootCause, "unvalidated_ncaaf_game_line_simulation");
  assert.notEqual(body?.failureReason, "zero_results");
});
