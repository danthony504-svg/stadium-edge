/**
 * Per-market gates, ATS harness independence, E4 prospective, diagnosis.
 * Never flips product gates. Never retunes FINAL_EVAL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ALT_CRITERIA,
  assertPerMarketGateIndependence,
  applyAtsRestTilt,
  computeAtsRestTilt,
  diagnoseNcaafMarkets,
  evaluateAltCriteria,
  evaluateSpreadCriteria,
  evaluateTotalsCriteria,
  E4_PROSPECTIVE_CRITERIA,
  isNcaafMarketProductValidated,
  legacyMasterGateConsistent,
  MARKET_GATE_POLICY,
  ML_ONLY_POLICY,
  NCAAF_GAME_LINE_SIM_VALIDATED,
  NCAAF_MARKET_SIM_VALIDATED,
  predictE1Frozen,
  runAtsHarness,
  runE4ProspectiveEval,
  SPREAD_CRITERIA,
  TOTALS_CRITERIA,
  CleanOppAdjStrength,
  buildPregameFromFixtureRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

test("per-market product gates all false; legacy master false", () => {
  assert.equal(NCAAF_GAME_LINE_SIM_VALIDATED, false);
  assert.equal(NCAAF_MARKET_SIM_VALIDATED.moneyline, false);
  assert.equal(NCAAF_MARKET_SIM_VALIDATED.spreads, false);
  assert.equal(NCAAF_MARKET_SIM_VALIDATED.totals, false);
  assert.equal(NCAAF_MARKET_SIM_VALIDATED.alts, false);
  assert.equal(isNcaafMarketProductValidated("moneyline"), false);
  assert.equal(legacyMasterGateConsistent(), true);
  assert.deepEqual(assertPerMarketGateIndependence(), {
    ok: true,
    validated: [],
  });
});

test("P3 policy: S2 does not auto-fail ML; no cross-market unlock", () => {
  assert.equal(ML_ONLY_POLICY.s2DoesNotAutoFailMl, true);
  assert.equal(ML_ONLY_POLICY.noCrossMarketUnlock, true);
  assert.equal(ML_ONLY_POLICY.injuryAdjustForbiddenOnFrozenMl, true);
  assert.equal(MARKET_GATE_POLICY.noCrossMarketUnlock, true);
  assert.equal(MARKET_GATE_POLICY.finalEvalImmutable, true);
});

test("spread criteria S2 fail does not imply ML fail label", () => {
  const spreads = evaluateSpreadCriteria({
    nAts: 250,
    atsBrier: 0.264,
    settlementCleared: true,
    marketAtsJuicePresent: false,
    atsBrierMarket: null,
  });
  assert.equal(spreads.find((c) => c.id === "S2")?.pass, false);
  // ML locked thresholds unchanged
  assert.equal(SPREAD_CRITERIA.S2_brierLt, 0.25);
});

test("totals/alts missing data → INSUFFICIENT_DATA not FAIL", () => {
  const totals = evaluateTotalsCriteria({
    closeTotalArchivePresent: false,
    nTotals: 0,
    totalsBrier: null,
  });
  assert.equal(totals[0]?.evidenceClass, "insufficient");
  assert.equal(totals[0]?.pass, null);
  const alts = evaluateAltCriteria({
    postedAltPricesPresent: false,
    nAlts: 0,
  });
  assert.equal(alts[0]?.evidenceClass, "insufficient");
  assert.equal(ALT_CRITERIA.A1_requirePostedAltPrices, true);
  assert.equal(TOTALS_CRITERIA.T1_requireCloseTotalArchive, true);
});

test("ATS harness: moneyline pass ignored; doesNotAffectMoneyline", () => {
  const report = runAtsHarness({
    games: [
      {
        gameId: "g1",
        homeScore: 28,
        awayScore: 21,
        decided: true,
        marginMean: 3,
        marginSd: 14,
      },
    ],
    closes: new Map([["g1", { gameId: "g1", closeSpreadHome: -3.5 }]]),
    otherMarketsPass: { moneyline: true },
  });
  assert.equal(report.doesNotAffectMoneyline, true);
  assert.equal(report.productUnlock.productUnlock, false);
  assert.ok(
    report.notes.some((n) => n.includes("moneyline pass ignored")),
  );
});

test("frozen E1 predict refuses injury path (availability never applied)", () => {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.off.set("2306", 30);
  strength.def.set("2306", 18);
  strength.off.set("66", 22);
  strength.def.set("66", 24);
  const pre = buildPregameFromFixtureRow({
    eventId: "t-freeze",
    season: 2025,
    week: 2,
    kickoffIso: "2025-09-06T16:00Z",
    homeTeamId: "2306",
    awayTeamId: "66",
    homeName: "Home",
    awayName: "Away",
    venueKind: "home",
  });
  const e1 = predictE1Frozen({ pregame: pre, strength });
  assert.equal(e1.ok, true);
  if (!e1.ok) return;
  assert.ok(!e1.featuresUsed.some((f) => f.startsWith("e4_")));
  assert.equal(e1.productionReleaseApproved, false);
});

test("E4 prospective: empty joins → INSUFFICIENT_DATA; M_base untouched", () => {
  const report = runE4ProspectiveEval([]);
  assert.equal(report.status, "INSUFFICIENT_DATA");
  assert.equal(report.e4Resolved, false);
  assert.equal(report.productE4Cleared, false);
  assert.equal(report.mBaseFrozenUntouched, true);
  assert.equal(report.mInjInheritsFinalEval, false);
  assert.equal(E4_PROSPECTIVE_CRITERIA.N1_minDecidedCloseMlWithJoinAttempt, 60);
});

test("ATS rest tilt research: missing rest fail-closed; clamp works", () => {
  const miss = computeAtsRestTilt({
    homeDaysRest: null,
    awayDaysRest: 7,
  });
  assert.equal(miss.applied, false);
  const big = applyAtsRestTilt({
    marginMean: 0,
    homeDaysRest: 14,
    awayDaysRest: 3,
  });
  assert.equal(big.tilt.applied, true);
  assert.ok(Math.abs(big.marginMean) <= 1.5 + 1e-9);
});

test("cache-only market diagnosis: ML metrics clear; other markets blocked", () => {
  const d = diagnoseNcaafMarkets();
  assert.equal(d.paidHttp, 0);
  assert.equal(d.finalEvalRetuned, false);
  assert.equal(d.legacyMasterGate, false);
  assert.equal(d.productGates.moneyline, false);
  assert.equal(d.productGates.spreads, false);
  assert.equal(d.independence.p3, true);
  assert.equal(d.independence.crossUnlockAttempts, 0);
  // Frozen FINAL_EVAL file must remain readable and unchanged by diagnosis.
  const frozenPath = join(
    process.cwd(),
    "test/fixtures/ncaaf-final-eval-frozen-score.json",
  );
  const frozen = JSON.parse(readFileSync(frozenPath, "utf8")) as {
    metrics?: { nMl?: number };
    acceptance?: { mlAllPass?: boolean };
  };
  assert.equal(frozen.metrics?.nMl, 403);
  assert.equal(frozen.acceptance?.mlAllPass, true);
  assert.equal(d.moneyline.metricsClear, true);
  assert.equal(d.totals.criteria[0]?.evidenceClass, "insufficient");
  assert.equal(d.alts.criteria[0]?.evidenceClass, "insufficient");
});
