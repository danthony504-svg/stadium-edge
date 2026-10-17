/**
 * ML-only harness tests — frozen E1 α=1.15, locked criteria, no FINAL_EVAL auto-pass.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLEAN_E1_ALPHA,
  CLEAN_E1_CANDIDATE_ID,
  CLV_CRITERIA,
  evaluateClvCriteria,
  evaluateMlCriteria,
  finalMlAcceptanceLabel,
  ML_CRITERIA,
  ML_ONLY_POLICY,
  predictE1Frozen,
  runMlOnlyHarness,
  CleanOppAdjStrength,
  buildPregameFromFixtureRow,
  predictScoreMargin,
  CLEAN_HFA_POINTS,
} from "../src/lib/sportSim/ncaafClean/index.ts";

test("frozen E1 alpha is exactly 1.15", () => {
  assert.equal(CLEAN_E1_ALPHA, 1.15);
  assert.equal(CLEAN_E1_CANDIDATE_ID, "E1_alpha_1_15");
});

test("predictE1Frozen scales rating gap then applies HFA; σ path intact", () => {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.off.set("2306", 30);
  strength.def.set("2306", 18);
  strength.off.set("66", 22);
  strength.def.set("66", 24);
  const pre = buildPregameFromFixtureRow({
    eventId: "t1",
    season: 2025,
    week: 2,
    kickoffIso: "2025-09-06T16:00Z",
    homeTeamId: "2306",
    awayTeamId: "66",
    homeName: "Home",
    awayName: "Away",
    venueKind: "home",
  });
  const a0 = predictScoreMargin({ pregame: pre, strength });
  const e1 = predictE1Frozen({ pregame: pre, strength });
  assert.equal(a0.ok, true);
  assert.equal(e1.ok, true);
  if (!a0.ok || !e1.ok) return;
  const pts0 = strength.expectedPoints("2306", "66", 0);
  const expected = CLEAN_E1_ALPHA * pts0.marginMean + CLEAN_HFA_POINTS;
  assert.ok(Math.abs(e1.marginMean - expected) < 1e-9);
  assert.equal(e1.marginSd, a0.marginSd);
  assert.equal(e1.productionReleaseApproved, false);
  assert.equal(e1.alpha, 1.15);
});

test("locked ML thresholds unchanged", () => {
  assert.equal(ML_CRITERIA.M1_minN, 200);
  assert.equal(ML_CRITERIA.M2_brierLt, 0.25);
  assert.equal(ML_CRITERIA.M3_maxDeltaVsMarket, 0.02);
  assert.equal(ML_CRITERIA.M4_maxAbsBias, 0.08);
  assert.equal(CLV_CRITERIA.C2_meanClvMin, 0);
  assert.equal(ML_ONLY_POLICY.s2DoesNotAutoFailMl, true);
  assert.equal(ML_ONLY_POLICY.tuningM3IsNotFinalPass, true);
});

test("evaluateMlCriteria M3 uses locked +0.02 slack", () => {
  const r = evaluateMlCriteria({
    nMl: 334,
    mlBrier: 0.19,
    mktBrier: 0.176,
    meanP: 0.55,
    meanY: 0.6,
  });
  const m3 = r.find((x) => x.id === "M3")!;
  assert.equal(m3.pass, true); // 0.014 <= 0.02
  const m3fail = evaluateMlCriteria({
    nMl: 334,
    mlBrier: 0.21,
    mktBrier: 0.176,
    meanP: 0.55,
    meanY: 0.6,
  }).find((x) => x.id === "M3")!;
  assert.equal(m3fail.pass, false);
});

test("CLV missing evidence stays missing — no invented pass", () => {
  const c = evaluateClvCriteria({
    available: false,
    nMlWithClv: null,
    meanClvProbPoints: null,
    pctSelectionsBeatClose: null,
    homeSelections: null,
    awaySelections: null,
    softGatesOk: null,
    earlyCachePicks: null,
  });
  assert.ok(c.every((x) => x.evidenceClass === "missing"));
  assert.ok(c.every((x) => x.pass === null));
});

test("CLV C2 rejects negative mean (no weakened floor)", () => {
  const c = evaluateClvCriteria({
    available: true,
    nMlWithClv: 60,
    meanClvProbPoints: -0.004,
    pctSelectionsBeatClose: 0.5,
    homeSelections: 30,
    awaySelections: 30,
    softGatesOk: true,
    earlyCachePicks: 60,
  });
  assert.equal(c.find((x) => x.id === "C2")!.pass, false);
  assert.equal(c.find((x) => x.id === "C6")!.pass, false);
});

test("TUNING acceptance never finalPass", () => {
  const ml = evaluateMlCriteria({
    nMl: 334,
    mlBrier: 0.19,
    mktBrier: 0.18,
    meanP: 0.55,
    meanY: 0.58,
  });
  const clv = evaluateClvCriteria({
    available: false,
    nMlWithClv: null,
    meanClvProbPoints: null,
    pctSelectionsBeatClose: null,
    homeSelections: null,
    awaySelections: null,
    softGatesOk: null,
    earlyCachePicks: null,
  });
  const acc = finalMlAcceptanceLabel({
    split: "TUNING",
    allowFinalEvalScoring: true,
    ml,
    clv,
    e4InjuryValidated: true,
  });
  assert.equal(acc.finalPass, false);
  assert.match(acc.reason, /TUNING/);
});

test("FINAL_EVAL harness refuses scoring when allowFinalEvalScoring=false", () => {
  const report = runMlOnlyHarness({
    split: "FINAL_EVAL",
    allowFinalEvalScoring: false,
    season: 2025,
    seedGames: [],
    walkGames: [
      {
        eventId: "x",
        season: 2025,
        week: 8,
        kickoffIso: "2025-10-18T16:00Z",
        homeTeamId: "1",
        awayTeamId: "2",
        homeName: "A",
        awayName: "B",
        homeFg: 21,
        awayFg: 14,
        outcomeSealed: true,
      },
    ],
    scoreEventIds: new Set(["x"]),
    closes: new Map([["x", { gameId: "x", closeMlHome: -150 }]]),
  });
  assert.equal(report.scored, false);
  assert.equal(report.metrics.nMl, 0);
  assert.equal(report.acceptance.finalPass, false);
  assert.equal(report.spreadsMarket.status, "BLOCKED_SEPARATE_GATE");
});
