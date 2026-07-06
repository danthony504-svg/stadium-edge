import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGameSimRecommendation,
  deriveGameSimLineMetrics,
  filterEvalLinesForProjectedMargin,
  hasCompleteEvaluatedLine,
  isAggressiveAltSpread,
  passesCoachSimQualityGate,
  projectedScoreMargin,
  qualifiesForBestLines,
  simEdgeFromHit,
  simEvPct,
  winProbEdgeBand,
  WIN_PROB_MIN_EDGE,
} from "./gameSimQualityGates.ts";
import type { EvaluatedGameLine } from "./gameLineOptimizer.ts";

function mockRow(
  overrides: Partial<EvaluatedGameLine> & { edge?: number; hit?: number; grade?: string; conf?: number },
): EvaluatedGameLine {
  const edge = overrides.edge ?? 2;
  const hit = overrides.hit ?? 0.55;
  return {
    entry: {
      sport: "mlb",
      game: "A @ B",
      market: "Spread",
      pick: "B +1.5",
      odds: -110,
      edge,
    },
    pick: { game: "A @ B", market: "Spread", pick: "B +1.5", odds: -110, isProp: false },
    finalAiScore: {
      composite: 7,
      grade: overrides.grade ?? "B",
      confidencePct: overrides.conf ?? 60,
      edgePct: edge,
      simHit: hit,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { scores: {}, composite: 7, grade: "B", confidencePct: 60, edgePct: edge },
    },
    winProb: hit,
    edgePct: edge,
    ...overrides,
  };
}

const baseSim = {
  sport: "mlb",
  simulations: 10_000,
  homeWinProbability: 0.501,
  awayWinProbability: 0.499,
  homeProjectedScore: 4.5,
  awayProjectedScore: 4.49,
  tieProbability: 0,
  mostLikelyWinner: "home" as const,
  mostLikelyWinnerPct: 0.501,
  confidenceScore: 50,
};

const tightSim = { ...baseSim };

test("winProbEdgeBand thresholds", () => {
  assert.equal(winProbEdgeBand(0.54), "no_edge");
  assert.equal(winProbEdgeBand(WIN_PROB_MIN_EDGE), "small_edge");
  assert.equal(winProbEdgeBand(0.59), "small_edge");
  assert.equal(winProbEdgeBand(0.62), "good_edge");
  assert.equal(winProbEdgeBand(0.68), "strong_edge");
});

test("classifyGameSimRecommendation: under 55% is No Betting Edge", () => {
  const rec = classifyGameSimRecommendation(
    { ...tightSim, homeWinProbability: 0.52, awayWinProbability: 0.48 },
    "Royals",
    "Phillies",
  );
  assert.equal(rec.tier, "pass");
  assert.equal(rec.label, "No Betting Edge");
  assert.equal(rec.favoredTeam, null);
});

test("classifyGameSimRecommendation: tier bands", () => {
  const small = classifyGameSimRecommendation(
    { ...baseSim, homeWinProbability: 0.57, awayWinProbability: 0.43 },
    "Royals",
    "Phillies",
  );
  assert.equal(small.tier, "small_edge");
  assert.equal(small.label, "Small Edge");
  assert.equal(small.favoredTeam, "Royals");

  const good = classifyGameSimRecommendation(
    { ...baseSim, homeWinProbability: 0.42, awayWinProbability: 0.62 },
    "Royals",
    "Phillies",
  );
  assert.equal(good.tier, "good_edge");
  assert.equal(good.label, "Good Edge");
  assert.equal(good.favoredTeam, "Phillies");

  const strong = classifyGameSimRecommendation(
    { ...baseSim, homeWinProbability: 0.68, awayWinProbability: 0.32 },
    "Royals",
    "Phillies",
  );
  assert.equal(strong.tier, "strong");
  assert.equal(strong.label, "Strong Edge");
});

test("hasCompleteEvaluatedLine rejects missing metrics", () => {
  assert.equal(hasCompleteEvaluatedLine(mockRow({})), true);
  assert.equal(
    hasCompleteEvaluatedLine(mockRow({ winProb: null, finalAiScore: { ...mockRow({}).finalAiScore, simHit: null } })),
    false,
  );
});

test("deriveGameSimLineMetrics requires sim hit, fair odds, EV, edge, grade, confidence", () => {
  const full = deriveGameSimLineMetrics(mockRow({ hit: 0.58, edge: 3.2 }));
  assert.ok(full);
  assert.ok(Number.isFinite(full!.fairOdds) && full!.fairOdds !== 0);
  assert.ok(full!.evPct != null);
  assert.equal(qualifiesForBestLines(mockRow({ hit: 0.58, edge: 3.2 })), true);
  assert.equal(qualifiesForBestLines(mockRow({ hit: 0.58, edge: -0.5 })), false);
});

test("simEvPct and simEdgeFromHit", () => {
  assert.equal(simEvPct(0.55, -110), 5);
  assert.ok(simEdgeFromHit(0.55, -110)! > 0);
});

test("filterEvalLinesForProjectedMargin drops aggressive alts on coin flip", () => {
  const lines = [
    { sport: "mlb", game: "A @ B", market: "Alt Spread", pick: "B +2.5", odds: -700 },
    { sport: "mlb", game: "A @ B", market: "Spread", pick: "B +1.5", odds: -110 },
    { sport: "mlb", game: "A @ B", market: "Moneyline", pick: "B ML", odds: -105 },
  ];
  const out = filterEvalLinesForProjectedMargin(lines, tightSim);
  assert.equal(out.length, 2);
});

test("isAggressiveAltSpread flags beyond ±1.5", () => {
  assert.equal(isAggressiveAltSpread("Alt Spread", "Phillies +2.5"), true);
  assert.equal(isAggressiveAltSpread("Spread", "Royals -1.5"), false);
});

test("passesCoachSimQualityGate requires edge, grade, confidence, and sim above implied", () => {
  const sim = { ...tightSim, coverHitRates: {} };
  const pick = { game: "A @ B", market: "Spread", pick: "B +1.5", odds: -110, isProp: false };
  assert.equal(
    passesCoachSimQualityGate(pick, sim, {
      finalAi: mockRow({ edge: 2, hit: 0.58, grade: "B+", conf: 60 }).finalAiScore,
      odds: -110,
    }),
    true,
  );
});

test("projectedScoreMargin", () => {
  assert.ok(projectedScoreMargin(tightSim) < 0.5);
});
