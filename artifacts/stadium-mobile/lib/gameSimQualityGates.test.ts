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
} from "./gameSimQualityGates.ts";
import type { EvaluatedGameLine } from "./gameLineOptimizer.ts";

const rubricScores = {
  matchup: null,
  trend: null,
  lineValue: null,
  injury: null,
  lineShopping: null,
  simulation: null,
};

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
      rubric: { scores: rubricScores, composite: 7, grade: "B", confidencePct: 60, edgePct: edge },
    },
    winProb: hit,
    edgePct: edge,
    ...overrides,
  };
}

const tightSim = {
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

test("hasCompleteEvaluatedLine rejects missing metrics", () => {
  assert.equal(hasCompleteEvaluatedLine(mockRow({})), true);
  assert.equal(
    hasCompleteEvaluatedLine(mockRow({ winProb: null, finalAiScore: { ...mockRow({}).finalAiScore, simHit: null } })),
    false,
  );
  assert.equal(
    hasCompleteEvaluatedLine(mockRow({ edge: -1, finalAiScore: { ...mockRow({ edge: -1 }).finalAiScore, edgePct: -1 } })),
    true,
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
  assert.ok(out.some((l) => l.pick.includes("+1.5")));
  assert.ok(!out.some((l) => l.pick.includes("+2.5")));
});

test("isAggressiveAltSpread flags beyond ±1.5", () => {
  assert.equal(isAggressiveAltSpread("Alt Spread", "Phillies +2.5"), true);
  assert.equal(isAggressiveAltSpread("Spread", "Royals -1.5"), false);
});

test("classifyGameSimRecommendation passes coin-flip games", () => {
  const rec = classifyGameSimRecommendation(
    {
      overall: mockRow({ edge: 0.2, hit: 0.5, grade: "C" }),
      byTeam: { away: mockRow({ edge: 0.2, hit: 0.5, grade: "C" }), home: null },
    },
    tightSim,
  );
  assert.equal(rec.tier, "pass");
  assert.match(rec.detail, /No betting edge found/i);
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
  assert.equal(
    passesCoachSimQualityGate(pick, sim, {
      finalAi: mockRow({ edge: 2, hit: 0.51, grade: "B+", conf: 60 }).finalAiScore,
      odds: -110,
    }),
    false,
  );
});

test("projectedScoreMargin", () => {
  assert.ok(projectedScoreMargin(tightSim) < 0.5);
});
