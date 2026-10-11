import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { mapScanFailureCode } from "./coachReliabilityClassify.ts";
import { buildCoachReliabilityBody } from "./coachReliabilityReporter.ts";
import { shouldSendCrashReports } from "./crashReportingGate.ts";

test("mapScanFailureCode mirrors server grounding/alt/sim/freeze", () => {
  assert.equal(mapScanFailureCode("TEAM_IDS_UNRESOLVED")?.alertable, true);
  assert.equal(mapScanFailureCode("PROP_POOL_EMPTY")?.eventType, "coach_alt_market_failure");
  assert.equal(mapScanFailureCode("GAME_SIMS_FETCH_EMPTY")?.failureReason, "missing_sim_output");
  assert.equal(mapScanFailureCode("QUALITY_BAR_EMPTY")?.alertable, false);
});

test("buildCoachReliabilityBody distinguishes legit underfill vs freeze", () => {
  const under = buildCoachReliabilityBody({
    requestedLegCount: 6,
    returnedLegCount: 4,
    realOddsAvailable: true,
    requestId: "greenfield-1",
  });
  assert.equal(under?.eventType, "parlay_underfilled");
  assert.equal(under?.failureReason, "legitimate_underfill");

  const freeze = buildCoachReliabilityBody({
    timedOut: true,
    requestedLegCount: 8,
    returnedLegCount: 0,
    requestId: "greenfield-2",
  });
  assert.equal(freeze?.scanFailureCode, "ABSOLUTE_BUDGET");

  const ground = buildCoachReliabilityBody({
    scanFailureCode: "TEAM_ID_MAP_EMPTY",
    requestedLegCount: 5,
    returnedLegCount: 0,
  });
  assert.equal(ground?.scanFailureCode, "TEAM_ID_MAP_EMPTY");
});

test("fixtures flag is preserved for server reject path", () => {
  const body = buildCoachReliabilityBody({
    scanFailureCode: "SCAN_THREW",
    testFixture: true,
    requestId: "reliability-synthetic",
  });
  assert.equal(body?.testFixture, true);
});

test("Node tests do not open production coach reliability POSTs", () => {
  assert.equal(shouldSendCrashReports(process.env), false);
});

test("buildParlay wires observe-only reporter after finalize", () => {
  const src = readFileSync(join(process.cwd(), "lib/coach/buildParlay.ts"), "utf8");
  assert.match(src, /reportCoachScanReliability/);
  assert.match(src, /Fire-and-forget reliability/);
  // Must not await the reporter (non-blocking).
  assert.equal(/await\s+reportCoachScanReliability/.test(src), false);
});
