import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyCoachQuestionKind,
  classifyCoachSportCategory,
  classifyParlayFailureReason,
  classifyParlayOutcome,
  coachAlertFingerprint,
  coachEventSummary,
  countCoachPickLines,
  mapScanFailureCode,
  parseCoachMeta,
  percentile,
  serializeCoachMeta,
  shouldAlertCoachEvent,
  COACH_ALERT_EVENT_TYPES,
  type CoachReliabilityMeta,
} from "../src/lib/coachReliabilitySanitize.ts";
import {
  isCoachReliabilityTestFixture,
  parseCoachReliabilityIngestBody,
} from "../src/lib/coachReliabilityIngest.ts";
import {
  formatCoachDailyDigestSection,
  formatCoachReliabilityAlert,
  formatDailyHealthySummary,
} from "../src/lib/telegramAlert.ts";

function baseMeta(
  overrides: Partial<CoachReliabilityMeta> = {},
): CoachReliabilityMeta {
  return {
    eventType: "parlay_underfilled",
    sportCategory: "mlb",
    questionKind: "parlay_build",
    requestedLegCount: 6,
    returnedLegCount: 2,
    durationMs: 1200,
    failureReason: "legitimate_underfill",
    failureCategory: "fulfillment",
    realOddsAvailable: true,
    qualificationFiltersEliminated: true,
    answered: null,
    requestId: "req_abc",
    affectedGame: null,
    rootCause: "thin_slate",
    ...overrides,
  };
}

test("classifyCoachSportCategory is sanitized and multi-aware", () => {
  assert.equal(classifyCoachSportCategory("build a 5 leg NFL parlay"), "nfl");
  assert.equal(classifyCoachSportCategory("NBA and NHL mix"), "multi");
  assert.equal(classifyCoachSportCategory("random ticket"), "unspecified");
  // Bare college / NCAAF must normalize to ncaaf (not unspecified).
  assert.equal(classifyCoachSportCategory("7 leg college"), "ncaaf");
  assert.equal(classifyCoachSportCategory("7 leg Collage"), "ncaaf");
  assert.equal(classifyCoachSportCategory("7 leg NCAAF"), "ncaaf");
  assert.equal(classifyCoachSportCategory("college basketball 5 leg"), "unspecified");
});

test("classifyCoachQuestionKind never requires raw text retention", () => {
  assert.equal(classifyCoachQuestionKind("build me a 6 leg parlay"), "parlay_build");
  assert.equal(classifyCoachQuestionKind("best live NBA bets"), "live_qa");
  assert.equal(classifyCoachQuestionKind("who is injured tonight"), "injury_qa");
  assert.equal(classifyCoachQuestionKind("hi", { hasImages: true }), "photo_qa");
});

test("countCoachPickLines and classifyParlayOutcome", () => {
  const text = "PICK: A\nEDGE: x\nPICK: B\n";
  assert.equal(countCoachPickLines(text), 2);
  assert.equal(
    classifyParlayOutcome({ requestedLegCount: 5, returnedLegCount: 5 }),
    "parlay_fulfilled",
  );
  assert.equal(
    classifyParlayOutcome({ requestedLegCount: 5, returnedLegCount: 3 }),
    "parlay_underfilled",
  );
  assert.equal(
    classifyParlayOutcome({ requestedLegCount: 5, returnedLegCount: 0 }),
    "parlay_zero_results",
  );
});

test("legitimate underfill is digest-only; system failures alert", () => {
  assert.equal(
    classifyParlayFailureReason({
      outcome: "parlay_underfilled",
      realOddsAvailable: true,
    }),
    "legitimate_underfill",
  );
  assert.equal(
    shouldAlertCoachEvent(baseMeta({ failureReason: "legitimate_underfill" })),
    false,
  );
  assert.equal(
    shouldAlertCoachEvent(
      baseMeta({
        eventType: "coach_grounding_failure",
        failureReason: "grounding_failure",
        failureCategory: "grounding",
      }),
    ),
    true,
  );
  assert.equal(
    shouldAlertCoachEvent(
      baseMeta({
        eventType: "coach_scan_freeze",
        failureReason: "scan_freeze",
        failureCategory: "scan_freeze",
      }),
    ),
    true,
  );
  assert.equal(COACH_ALERT_EVENT_TYPES.has("parlay_underfilled"), false);
  assert.equal(COACH_ALERT_EVENT_TYPES.has("coach_grounding_failure"), true);
  assert.equal(COACH_ALERT_EVENT_TYPES.has("coach_alt_market_failure"), true);
  assert.equal(COACH_ALERT_EVENT_TYPES.has("coach_simulation_failure"), true);
  assert.equal(COACH_ALERT_EVENT_TYPES.has("coach_scan_freeze"), true);
});

test("mapScanFailureCode covers grounding/alt/sim/freeze", () => {
  assert.equal(mapScanFailureCode("TEAM_IDS_UNRESOLVED")?.eventType, "coach_grounding_failure");
  assert.equal(mapScanFailureCode("NO_ODDS_GAMES")?.eventType, "coach_odds_mismatch");
  assert.equal(mapScanFailureCode("PROP_POOL_EMPTY")?.eventType, "coach_alt_market_failure");
  assert.equal(mapScanFailureCode("GAME_SIMS_ALL_NULL")?.failureReason, "missing_sim_output");
  assert.equal(mapScanFailureCode("ABSOLUTE_BUDGET")?.eventType, "coach_scan_freeze");
  assert.equal(mapScanFailureCode("QUALITY_BAR_EMPTY")?.alertable, false);
  // Phase E block ≠ ordinary zero_results.
  assert.equal(mapScanFailureCode("P0_UNVALIDATED_MARKETS")?.eventType, "coach_simulation_failure");
  assert.equal(
    mapScanFailureCode("P0_UNVALIDATED_MARKETS")?.failureReason,
    "unvalidated_simulation",
  );
  assert.equal(mapScanFailureCode("P0_UNVALIDATED_MARKETS")?.alertable, true);
});

test("coachEventSummary surfaces unvalidated_ncaaf_game_line_simulation", () => {
  const summary = coachEventSummary(
    baseMeta({
      eventType: "coach_simulation_failure",
      failureReason: "unvalidated_simulation",
      sportCategory: "ncaaf",
      rootCause: "unvalidated_ncaaf_game_line_simulation",
      requestedLegCount: 7,
      returnedLegCount: 0,
    }),
  );
  assert.match(summary, /unvalidated_simulation/);
  assert.match(summary, /unvalidated_ncaaf_game_line_simulation/);
  assert.match(summary, /ncaaf/);
  assert.doesNotMatch(summary, /zero_results/);
});

test("serialize/parse coach meta has no PII fields", () => {
  const raw = serializeCoachMeta(baseMeta());
  assert.equal(raw.includes("@"), false);
  assert.equal(raw.includes("user_"), false);
  assert.equal(raw.includes("Bearer"), false);
  const parsed = parseCoachMeta(raw);
  assert.equal(parsed?.eventType, "parlay_underfilled");
  assert.equal(parsed?.requestId, "req_abc");
  assert.equal(parsed?.failureCategory, "fulfillment");
});

test("fingerprint and summary stay short and sanitized", () => {
  const fp = coachAlertFingerprint(
    baseMeta({
      eventType: "coach_timeout",
      failureReason: "timeout",
      failureCategory: "timeout",
      sportCategory: "nba",
      requestedLegCount: 10,
      returnedLegCount: 0,
    }),
  );
  assert.match(fp, /^coach\|/);
  const summary = coachEventSummary(
    baseMeta({
      eventType: "parlay_zero_results",
      failureReason: "zero_results",
      sportCategory: "nfl",
      requestedLegCount: 8,
      returnedLegCount: 0,
    }),
  );
  assert.match(summary, /parlay_zero_results/);
  assert.match(summary, /0\/8/);
});

test("percentile helper", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
});

test("telegram coach alert includes requestId/category without PII", () => {
  const alert = formatCoachReliabilityAlert({
    eventType: "coach_grounding_failure",
    summary: "Coach coach_grounding_failure · nfl · parlay_build · 0/6 legs",
    sportCategory: "nfl",
    requestedLegCount: 6,
    returnedLegCount: 0,
    durationMs: 1500,
    failureReason: "grounding_failure",
    failureCategory: "grounding",
    realOddsAvailable: true,
    qualificationFiltersEliminated: true,
    requestId: "greenfield-123",
    affectedGame: "Away vs Home",
    rootCause: "TEAM_IDS_UNRESOLVED",
    occurrenceCount: 2,
  });
  assert.match(alert, /Coach alert/);
  assert.match(alert, /grounding/);
  assert.match(alert, /requestId: greenfield-123/);
  assert.equal(alert.includes("user_"), false);
  assert.equal(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(alert), false);

  const section = formatCoachDailyDigestSection({
    totalRequests: 40,
    successfulRequests: 28,
    fulfillmentPct: 70,
    underfillCount: 8,
    legitimateUnderfillCount: 6,
    zeroResultCount: 4,
    questionFailureCount: 3,
    groundingFailureCount: 1,
    altMarketFailureCount: 1,
    simulationFailureCount: 2,
    scanFreezeCount: 1,
    p50Ms: 1200,
    p95Ms: 8000,
    topFailureReasons: [{ reason: "legitimate_underfill", count: 6 }],
  });
  assert.match(section, /fulfillment: 70%/);
  assert.match(section, /legit 6/);
  assert.match(section, /grounding\/alt\/sim\/freeze: 1\/1\/2\/1/);

  const daily = formatDailyHealthySummary({
    windowHours: 24,
    criticalCount: 0,
    distinctFingerprints: 0,
    lastCriticalAt: null,
    healthOk: true,
    coach: {
      totalRequests: 10,
      successfulRequests: 7,
      fulfillmentPct: 70,
      underfillCount: 2,
      zeroResultCount: 1,
      questionFailureCount: 0,
      p50Ms: 900,
      p95Ms: 4000,
      topFailureReasons: [],
    },
  });
  assert.doesNotMatch(daily, /reliability — healthy/);
  assert.match(daily, /Coach activity \(received events\)/);
  assert.match(daily, /Server health \(probes\)/);
  assert.match(daily, /all checks OK/);
  assert.match(daily, /0 critical crash reports received/);
});

test("zero Coach requests in digest is coverage gap, not verified inactivity", () => {
  const section = formatCoachDailyDigestSection({
    totalRequests: 0,
    successfulRequests: 0,
    fulfillmentPct: null,
    underfillCount: 0,
    zeroResultCount: 0,
    questionFailureCount: 0,
    p50Ms: null,
    p95Ms: null,
    topFailureReasons: [],
  });
  assert.match(section, /requests received: 0/);
  assert.match(section, /0 received Coach events ≠ verified zero Coach usage/);
});

test("test fixtures never parse as alertable production events", () => {
  assert.equal(
    isCoachReliabilityTestFixture({
      requestId: "reliability-synthetic",
      eventType: "coach_scan_freeze",
    }),
    true,
  );
  assert.equal(
    isCoachReliabilityTestFixture({
      testFixture: true,
      scanFailureCode: "TEAM_IDS_UNRESOLVED",
    }),
    true,
  );
  assert.equal(
    isCoachReliabilityTestFixture({
      eventType: "coach_grounding_failure",
      requestId: "greenfield-real",
    }),
    false,
  );
});

test("ingest body maps scan codes and rejects junk", () => {
  const mapped = parseCoachReliabilityIngestBody({
    scanFailureCode: "GAME_SIMS_TIMED_OUT",
    sportCategory: "nfl",
    requestedLegCount: 8,
    returnedLegCount: 0,
    requestId: "greenfield-9",
    scanFailureDetail: "game sims timed out",
  });
  assert.equal(mapped?.eventType, "coach_simulation_failure");
  assert.equal(mapped?.failureReason, "simulation_failure");
  assert.equal(mapped?.requestId, "greenfield-9");
  assert.equal(parseCoachReliabilityIngestBody({ eventType: "nope" }), null);
});

test("temporary correlationId is parsed for coach-events diagnostics only", () => {
  const parsed = parseCoachReliabilityIngestBody({
    eventType: "parlay_underfilled",
    failureReason: "legitimate_underfill",
    sportCategory: "nfl",
    questionKind: "parlay_build",
    requestedLegCount: 8,
    returnedLegCount: 5,
    requestId: "greenfield-diag",
    correlationId: "crdiag-123-abcd",
    affectedGame: "Minnesota Vikings @ New Orleans Saints",
  });
  assert.ok(parsed);
  assert.equal(parsed!.correlationId, "crdiag-123-abcd");
  assert.equal(parsed!.eventType, "parlay_underfilled");
  assert.equal(parsed!.failureReason, "legitimate_underfill");
  assert.equal(parsed!.requestId, "greenfield-diag");
  // Classification unchanged — correlationId is observe-only.
  assert.equal(parsed!.failureCategory, "fulfillment");
});

test("chat route wires observe-only coach reliability hooks", () => {
  const src = readFileSync(join(process.cwd(), "src/routes/chat.ts"), "utf8");
  assert.match(src, /reportCoachReliability/);
  assert.match(src, /parlay_requested/);
  assert.match(src, /parlay_underfilled|classifyParlayOutcome/);
  assert.match(src, /coach_timeout/);
  assert.match(src, /coach_question_received/);
  assert.match(src, /coach_empty_response/);
  assert.match(src, /classifyParlayFailureReason/);
  // Must not log raw ask text or userId into reliability reports.
  assert.equal(/reportCoachReliability\(\{[\s\S]{0,200}userId/.test(src), false);
  assert.equal(/reportCoachReliability\(\{[\s\S]{0,200}gateAskText/.test(src), false);
});

test("temporary coach-rel-diag logs are wired on coach-events path", () => {
  const route = readFileSync(join(process.cwd(), "src/routes/reliability.ts"), "utf8");
  const store = readFileSync(
    join(process.cwd(), "src/lib/coachReliabilityStore.ts"),
    "utf8",
  );
  assert.match(route, /\[coach-rel-diag\] coach-events route/);
  assert.match(store, /\[coach-rel-diag\] coach-event/);
  assert.match(store, /telegramEligible/);
  assert.match(store, /dedupeSuppressed/);
  assert.match(store, /correlationId/);
});

test("digest + health cron routes exist", () => {
  const src = readFileSync(
    join(process.cwd(), "src/routes/reliability.ts"),
    "utf8",
  );
  assert.match(src, /coachReliabilityDigestStats/);
  assert.match(src, /\/reliability\/cron\/health/);
  assert.match(src, /\/reliability\/coach-events/);
  assert.match(src, /isCoachReliabilityTestFixture/);
});

test("no SIM_V2_SERVE flip in coach reliability files", () => {
  const files = [
    "src/lib/coachReliabilitySanitize.ts",
    "src/lib/coachReliabilityStore.ts",
    "src/lib/telegramAlert.ts",
    "src/routes/reliability.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.equal(src.includes("SIM_V2_SERVE"), false);
  }
});
