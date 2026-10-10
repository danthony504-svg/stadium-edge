import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyCoachQuestionKind,
  classifyCoachSportCategory,
  classifyParlayOutcome,
  coachAlertFingerprint,
  coachEventSummary,
  countCoachPickLines,
  parseCoachMeta,
  percentile,
  serializeCoachMeta,
  COACH_ALERT_EVENT_TYPES,
} from "../src/lib/coachReliabilitySanitize.ts";
import { formatCoachDailyDigestSection, formatCoachReliabilityAlert, formatDailyHealthySummary } from "../src/lib/telegramAlert.ts";

test("classifyCoachSportCategory is sanitized and multi-aware", () => {
  assert.equal(classifyCoachSportCategory("build a 5 leg NFL parlay"), "nfl");
  assert.equal(classifyCoachSportCategory("NBA and NHL mix"), "multi");
  assert.equal(classifyCoachSportCategory("random ticket"), "unspecified");
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

test("serialize/parse coach meta has no PII fields", () => {
  const raw = serializeCoachMeta({
    eventType: "parlay_underfilled",
    sportCategory: "mlb",
    questionKind: "parlay_build",
    requestedLegCount: 6,
    returnedLegCount: 2,
    durationMs: 1200,
    failureReason: "underfilled",
    realOddsAvailable: true,
    qualificationFiltersEliminated: true,
    answered: null,
  });
  assert.equal(raw.includes("@"), false);
  assert.equal(raw.includes("user_"), false);
  assert.equal(raw.includes("Bearer"), false);
  const parsed = parseCoachMeta(raw);
  assert.equal(parsed?.eventType, "parlay_underfilled");
  assert.equal(parsed?.requestedLegCount, 6);
  assert.equal(parsed?.realOddsAvailable, true);
});

test("alert event set matches product requirements", () => {
  for (const t of [
    "parlay_underfilled",
    "parlay_zero_results",
    "coach_timeout",
    "coach_exception",
    "coach_question_failed",
    "coach_empty_response",
  ] as const) {
    assert.equal(COACH_ALERT_EVENT_TYPES.has(t), true);
  }
  assert.equal(COACH_ALERT_EVENT_TYPES.has("parlay_requested"), false);
  assert.equal(COACH_ALERT_EVENT_TYPES.has("parlay_fulfilled"), false);
  assert.equal(COACH_ALERT_EVENT_TYPES.has("coach_question_received"), false);
});

test("fingerprint and summary stay short and sanitized", () => {
  const fp = coachAlertFingerprint({
    eventType: "coach_timeout",
    sportCategory: "nba",
    questionKind: "parlay_build",
    requestedLegCount: 10,
    returnedLegCount: 0,
    durationMs: 240000,
    failureReason: "timeout",
    realOddsAvailable: true,
    qualificationFiltersEliminated: null,
    answered: false,
  });
  assert.match(fp, /^coach\|/);
  assert.equal(fp.includes("password"), false);
  const summary = coachEventSummary({
    eventType: "parlay_zero_results",
    sportCategory: "nfl",
    questionKind: "parlay_build",
    requestedLegCount: 8,
    returnedLegCount: 0,
    durationMs: 900,
    failureReason: "zero_results",
    realOddsAvailable: false,
    qualificationFiltersEliminated: true,
    answered: null,
  });
  assert.match(summary, /parlay_zero_results/);
  assert.match(summary, /0\/8/);
});

test("percentile helper", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
});

test("telegram coach alert and digest formatters", () => {
  const alert = formatCoachReliabilityAlert({
    eventType: "parlay_underfilled",
    summary: "Coach parlay_underfilled · mlb · parlay_build · 2/6 legs",
    sportCategory: "mlb",
    requestedLegCount: 6,
    returnedLegCount: 2,
    durationMs: 1500,
    failureReason: "underfilled",
    realOddsAvailable: true,
    qualificationFiltersEliminated: true,
    occurrenceCount: 2,
  });
  assert.match(alert, /Coach alert/);
  assert.match(alert, /underfilled/);
  assert.equal(alert.includes("@"), false);
  assert.equal(alert.includes("user_"), false);

  const section = formatCoachDailyDigestSection({
    totalRequests: 40,
    successfulRequests: 28,
    fulfillmentPct: 70,
    underfillCount: 8,
    zeroResultCount: 4,
    questionFailureCount: 3,
    p50Ms: 1200,
    p95Ms: 8000,
    topFailureReasons: [{ reason: "underfilled", count: 8 }],
  });
  assert.match(section, /fulfillment: 70%/);
  assert.match(section, /p50\/p95 ms: 1200 \/ 8000/);

  const daily = formatDailyHealthySummary({
    windowHours: 24,
    criticalCount: 0,
    distinctFingerprints: 0,
    lastCriticalAt: null,
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
  assert.match(daily, /healthy/);
  assert.match(daily, /Coach fulfillment/);
});

test("chat route wires observe-only coach reliability hooks", () => {
  const src = readFileSync(join(process.cwd(), "src/routes/chat.ts"), "utf8");
  assert.match(src, /reportCoachReliability/);
  assert.match(src, /parlay_requested/);
  assert.match(src, /parlay_underfilled|classifyParlayOutcome/);
  assert.match(src, /coach_timeout/);
  assert.match(src, /coach_question_received/);
  assert.match(src, /coach_empty_response/);
  // Must not log raw ask text or userId into reliability reports.
  assert.equal(/reportCoachReliability\(\{[\s\S]{0,200}userId/.test(src), false);
  assert.equal(/reportCoachReliability\(\{[\s\S]{0,200}gateAskText/.test(src), false);
});

test("digest cron includes coach stats", () => {
  const src = readFileSync(
    join(process.cwd(), "src/routes/reliability.ts"),
    "utf8",
  );
  assert.match(src, /coachReliabilityDigestStats/);
  assert.match(src, /coach,/);
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
