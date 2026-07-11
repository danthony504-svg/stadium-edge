import test from "node:test";
import assert from "node:assert/strict";
import {
  NOT_AI_RECOMMENDED,
  filterAiRecommendedPicks,
  filterTicketPicks,
  pickGradeDisplayLabel,
  pickIsAiRecommended,
  qualifiesAltPick,
} from "./pickRecommendation.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import { NOT_YET_AI_GRADED } from "./simMarketSupport.ts";

test("qualifiesAltPick accepts softer thresholds without recommends flag", () => {
  const score = {
    composite: 6,
    grade: "C+",
    confidencePct: 50,
    edgePct: 1.2,
    simHit: 0.52,
    simAligned: false,
    highRiskValuePlay: false,
    recommends: false,
    factors: [],
    rubric: { composite: 6, grade: "C+", confidencePct: 50, edgePct: 1.2, scores: {} as never },
  };
  assert.equal(
    qualifiesAltPick({ market: "Alt Spread", sport: "mlb", odds: 110 }, score),
    true,
  );
  assert.equal(
    qualifiesAltPick(
      { market: "Alt Spread", sport: "mlb", odds: 110 },
      { ...score, edgePct: -0.5 },
    ),
    false,
  );
});

test("filterTicketPicks keeps staged alt legs that fail strict main gate", () => {
  const altLeg = {
    game: "A @ B",
    market: "Alt Spread",
    pick: "A +2.5",
    odds: 115,
    ticketRole: "alt" as const,
    finalAiScore: {
      composite: 6,
      grade: "C+",
      confidencePct: 51,
      edgePct: 1.1,
      simHit: 0.51,
      simAligned: false,
      highRiskValuePlay: false,
      recommends: false,
      factors: [],
      rubric: { composite: 6, grade: "C+", confidencePct: 51, edgePct: 1.1, scores: {} as never },
    },
  };
  const out = filterTicketPicks([altLeg]);
  assert.equal(out.length, 1);
});

test("pickIsAiRecommended requires sim grade and positive thresholds", () => {
  const score = {
    composite: 8,
    grade: "A",
    confidencePct: 65,
    edgePct: 4,
    simHit: 0.58,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: { composite: 8, grade: "A", confidencePct: 65, edgePct: 4, scores: {} as never },
  };
  assert.equal(pickIsAiRecommended({ market: "Spread", sport: "nba", odds: -110 }, score), true);
});

test("pickGradeDisplayLabel shows Not AI Recommended when sim exists but thresholds fail", () => {
  const score = buildFinalAiScore({
    pick: {
      game: "A @ B",
      market: "Spread",
      pick: "B -3.5",
      odds: -110,
      isProp: false,
      sport: "nba",
    },
    rubricScores: {
      matchup: 5,
      trend: 5,
      lineValue: 5,
      injury: 5,
      lineShopping: 5,
      simulation: 5,
    },
    edgePct: -1,
    gameSim: {
      sport: "nba",
      simulations: 10_000,
      homeWinProbability: 0.48,
      awayWinProbability: 0.52,
      tieProbability: 0,
      homeProjectedScore: 108,
      awayProjectedScore: 109,
      mostLikelyWinner: "away",
      mostLikelyWinnerPct: 0.52,
      confidenceScore: 50,
      coverHitRates: { "a @ b|spread|b -3.5": 0.49 },
    },
  });
  assert.equal(
    pickGradeDisplayLabel({ market: "Spread", sport: "nba", odds: -110 }, score),
    NOT_AI_RECOMMENDED,
  );
});

test("filterAiRecommendedPicks removes sub-threshold legs", () => {
  const good = {
    game: "A @ B",
    market: "Spread",
    pick: "B -3.5",
    odds: -110,
    isProp: false,
    sport: "nba",
    finalAiScore: {
      composite: 8,
      grade: "A",
      confidencePct: 65,
      edgePct: 4,
      simHit: 0.58,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: { composite: 8, grade: "A", confidencePct: 65, edgePct: 4, scores: {} as never },
    },
  };
  const weak = {
    ...good,
    finalAiScore: {
      ...good.finalAiScore,
      edgePct: -2,
      recommends: false,
      simHit: 0.44,
    },
  };
  const out = filterAiRecommendedPicks([good, weak]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.pick, good.pick);
});

test("unsupported market uses not-yet-graded path via pickHasSimGrade", () => {
  assert.equal(
    pickGradeDisplayLabel({ market: "Both Teams To Score", sport: "soccer" }, null),
    null,
  );
});
