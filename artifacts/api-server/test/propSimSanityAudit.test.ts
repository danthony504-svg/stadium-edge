/**
 * Offline CI harness for propSimSanityAudit.
 * Fixture-only — never imports Coach request handlers or network clients.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROP_SIM_SANITY_AUDIT_OFFLINE_ONLY,
  auditPropSimResult,
  auditPropSimSuite,
  type PropSimSanityInput,
  type PropSimSanityReport,
} from "../src/lib/propSimSanityAudit.ts";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/propSimSanity");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

test("propSimSanityAudit is marked offline-only", () => {
  assert.equal(PROP_SIM_SANITY_AUDIT_OFFLINE_ONLY, true);
});

test("synthetic PASS / YELLOW / RED controls", () => {
  const pass = auditPropSimResult({
    sport: "nba",
    athlete: "A",
    providerMarket: "player_points",
    side: "Over",
    line: 20.5,
    histValues: [21, 19, 22, 20],
    histMean: 20.5,
    recentMean: 20.5,
    histClearRate: 0.5,
    bareProjectionMean: 20.5,
    finalProjectionMean: 20.8,
    combinedPreSimMultiplier: 1.015,
    simHitProbability: 0.52,
    impliedProbability: 0.52,
  });
  assert.equal(pass.status, "PASS");

  const yellow = auditPropSimResult({
    sport: "nba",
    athlete: "B",
    providerMarket: "player_points",
    side: "Over",
    line: 20.5,
    histValues: [21, 22, 20, 23],
    histMean: 21.5,
    histClearRate: 0.75,
    bareProjectionMean: 21.5,
    finalProjectionMean: 24.5,
    combinedPreSimMultiplier: 1.14,
    simHitProbability: 0.84,
    impliedProbability: 0.5,
  });
  assert.equal(yellow.status, "YELLOW");
  assert.ok(yellow.flags.includes("extreme_multiplier") || yellow.flags.includes("extreme_sim_vs_history"));

  const red = auditPropSimResult({
    sport: "nfl",
    athlete: "C",
    providerMarket: "player_pass_completions",
    side: "Over",
    line: 27.5,
    histValues: [30, 29, 27, 35],
    histMean: 30.25,
    histClearRate: 0.75,
    bareProjectionMean: 30.26,
    finalProjectionMean: 36.59,
    combinedPreSimMultiplier: 1.209,
    simHitProbability: 0.981,
    impliedProbability: 0.1845,
  });
  assert.equal(red.status, "RED");
  assert.ok(red.flags.includes("extreme_multiplier"));
  assert.ok(red.flags.includes("extreme_sim_vs_history"));
});

test("period full-game contamination flags RED", () => {
  const r = auditPropSimResult({
    sport: "nba",
    athlete: "D",
    providerMarket: "player_points_q1",
    side: "Over",
    line: 6.5,
    histValues: [22, 28, 25, 27],
    histMean: 25.5,
    bareProjectionMean: 25.5,
    finalProjectionMean: 25.5,
    combinedPreSimMultiplier: 1,
    simHitProbability: 0.99,
    periodTaggedAsFullGame: true,
  });
  assert.equal(r.status, "RED");
  assert.ok(r.flags.includes("period_fullgame_contamination"));
});

test("Over/Under inconsistency flags RED", () => {
  const r = auditPropSimResult({
    sport: "mlb",
    athlete: "E",
    providerMarket: "batter_hits",
    side: "Over",
    line: 1.5,
    histValues: [1, 2, 1, 2],
    histMean: 1.5,
    bareProjectionMean: 1.5,
    finalProjectionMean: 1.5,
    combinedPreSimMultiplier: 1,
    simHitProbability: 0.9,
    oppositeSideHitProbability: 0.9,
  });
  assert.equal(r.status, "RED");
  assert.ok(r.flags.includes("over_under_inconsistent"));
});

test("cross-sport fixture suites run for every applicable sport", () => {
  const file = loadJson<{
    suites: Array<{ sport: string; label?: string; props: PropSimSanityInput[] }>;
  }>("cross-sport-samples.json");
  const sports = new Set(file.suites.map((s) => s.sport));
  for (const required of ["nfl", "ncaaf", "nba", "wnba", "ncaab", "mlb", "nhl", "soccer"]) {
    assert.ok(sports.has(required), `missing suite for ${required}`);
  }
  for (const suite of file.suites) {
    if (!suite.props.length) {
      // Tennis/UFC: no applicable prop-stat markets in current sim surface.
      assert.ok(["tennis", "ufc"].includes(suite.sport));
      continue;
    }
    const result = auditPropSimSuite(suite.sport, suite.props, suite.label);
    assert.equal(result.reports.length, suite.props.length);
    for (const report of result.reports) {
      assert.ok(["PASS", "YELLOW", "RED"].includes(report.status));
      assertFieldsPresent(report);
    }
  }
});

function assertFieldsPresent(r: PropSimSanityReport) {
  assert.ok(r.athlete);
  assert.ok(r.providerMarket);
  assert.ok(Number.isFinite(r.line));
  assert.ok(r.side);
  // Reported fields may be null when fixture omits them — but keys exist.
  for (const key of [
    "historicalMean",
    "recentMean",
    "relevantVenueSplit",
    "historicalClearRate",
    "bareProjectionMean",
    "finalProjectionMean",
    "opportunityMultiplier",
    "efficiencyMultiplier",
    "combinedPreSimMultiplier",
    "simulatedHitProbability",
    "impliedProbability",
    "edge",
  ] as const) {
    assert.ok(key in r, key);
  }
}

test("Saints extreme recorded props — explain PASS/YELLOW/RED", () => {
  const file = loadJson<{
    sport: string;
    props: PropSimSanityInput[];
  }>("nfl-saints-extremes.json");
  const suite = auditPropSimSuite(file.sport, file.props, "Saints extremes");
  assert.equal(suite.reports.length, 6);

  const byKey = (athlete: string, market: string, line: number) =>
    suite.reports.find(
      (r) => r.athlete === athlete && r.providerMarket === market && r.line === line,
    )!;

  const explanations: Array<{ key: string; status: string; why: string }> = [];

  const cases: Array<[string, string, number, string]> = [
    ["Tyler Shough", "player_pass_completions", 27.5, "Shough completions O27.5"],
    ["Tyler Shough", "player_pass_attempts", 44.5, "Shough attempts O44.5"],
    ["Tyler Shough", "player_pass_yds", 266.5, "Shough pass yards O266.5"],
    ["Chris Olave", "player_receptions", 6.5, "Olave receptions O6.5"],
    ["Juwan Johnson", "player_reception_yds", 42.5, "Juwan rec yards O42.5"],
    ["Juwan Johnson", "player_reception_longest", 17.5, "Juwan longest rec O17.5"],
  ];

  for (const [athlete, market, line, label] of cases) {
    const r = byKey(athlete, market, line);
    assertFieldsPresent(r);
    explanations.push({
      key: label,
      status: r.status,
      why: r.reasons.join(" "),
    });
  }

  // Shough trio: after QB pre-sim factor fix — no unexplained ~1.21× inflate.
  for (const line of [27.5, 44.5, 266.5]) {
    const r = byKey(
      "Tyler Shough",
      line === 266.5
        ? "player_pass_yds"
        : line === 44.5
          ? "player_pass_attempts"
          : "player_pass_completions",
      line,
    );
    assert.equal(r.status, "PASS", `Shough ${line} expected PASS after factor fix`);
    assert.ok(!r.flags.includes("extreme_multiplier"), `Shough ${line} no extreme_multiplier`);
    assert.ok(!r.flags.includes("extreme_sim_vs_history"), `Shough ${line} no extreme_sim_vs_history`);
    assert.ok(
      r.combinedPreSimMultiplier != null && r.combinedPreSimMultiplier < 1.12,
      `Shough ${line} combined mult in band`,
    );
  }

  // Olave / Juwan: high sim hit is supported by 100% historical clear + means
  // well above the line; combined mult ~0.93 (deflate, not inflate) → PASS.
  for (const [athlete, market, line] of [
    ["Chris Olave", "player_receptions", 6.5],
    ["Juwan Johnson", "player_reception_yds", 42.5],
    ["Juwan Johnson", "player_reception_longest", 17.5],
  ] as const) {
    const r = byKey(athlete, market, line);
    assert.equal(r.status, "PASS", `${athlete} ${market} expected PASS`);
    assert.ok(!r.flags.includes("extreme_multiplier"));
    assert.ok(!r.flags.includes("wrong_player_team_opponent"));
    assert.ok(!r.flags.includes("provider_line_mutation"));
    assert.ok(!r.flags.includes("opportunity_applied_twice"));
  }

  const reportPath = join(FIXTURE_DIR, "saints-extremes-audit-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        worstStatus: suite.worstStatus,
        counts: suite.counts,
        explanations,
        reports: suite.reports,
      },
      null,
      2,
    ),
  );
});
