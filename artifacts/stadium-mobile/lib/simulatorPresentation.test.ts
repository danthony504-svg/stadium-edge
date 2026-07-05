import assert from "node:assert/strict";
import test from "node:test";
import type { GameSimulationResult } from "./api.ts";
import {
  buildTopAiPicks,
  formatFinalScoreLine,
  gameAiPrediction,
  gameConfidenceLevel,
  propPickRecommendation,
  whatChangedSinceLastRun,
} from "./simulatorPresentation.ts";
import type { CombinedPickScore } from "./pickScore.ts";

const gameResult: GameSimulationResult = {
  sport: "mlb",
  simulations: 10000,
  homeWinProbability: 0.54,
  awayWinProbability: 0.44,
  tieProbability: 0.02,
  homeProjectedScore: 4.6,
  awayProjectedScore: 4.1,
  mostLikelyWinner: "home",
  mostLikelyWinnerPct: 0.54,
  confidenceScore: 72,
};

test("gameAiPrediction and confidence level", () => {
  assert.match(gameAiPrediction(gameResult, "Atlanta Braves", "New York Mets"), /Braves to win/);
  assert.equal(gameConfidenceLevel(72), "High");
  assert.equal(gameConfidenceLevel(55), "Medium");
  assert.equal(gameConfidenceLevel(40), "Low");
});

test("formatFinalScoreLine rounds projected scores", () => {
  assert.equal(formatFinalScoreLine("New York Mets", "Atlanta Braves", gameResult), "Mets 4 – Braves 5");
});

test("whatChangedSinceLastRun detects winner flip", () => {
  const prev = {
    gameId: "g1",
    winnerSide: "away" as const,
    winPct: 0.52,
    awayScore: 4,
    homeScore: 3.8,
    topPropKey: "a",
    weatherLabel: "Clear",
    injuryCount: 1,
    ranAt: Date.now() - 60_000,
  };
  const next = {
    ...prev,
    winnerSide: "home" as const,
    winPct: 0.58,
    homeScore: 4.6,
    ranAt: Date.now(),
  };
  const changes = whatChangedSinceLastRun(prev, next, { home: "Atlanta Braves", away: "New York Mets" });
  assert.ok(changes.some((c) => c.includes("flipped")));
});

test("propPickRecommendation labels quality picks", () => {
  const combined = {
    scores: {
      matchup: 7,
      trend: 7,
      lineValue: 8,
      injury: 6,
      lineShopping: 6,
      simulation: 7,
    },
    composite: 8.2,
    grade: "A-",
    confidencePct: 68,
    edgePct: 3.1,
  } satisfies CombinedPickScore;
  assert.equal(propPickRecommendation(combined, { hitProbability: 0.58 } as any), "Best Bet");
});

test("buildTopAiPicks fills four slots", () => {
  const ranked = [
    {
      key: "a",
      row: { player: "Alpha", market: "batter_hits", line: 1.5, side: "Over" } as any,
      combined: { composite: 8, grade: "A-", edgePct: 3, confidencePct: 70, scores: {} as any },
      rankScore: 90,
      recommendation: "Best Bet" as const,
    },
  ];
  const slots = buildTopAiPicks(ranked, (m) => m);
  assert.equal(slots.length, 4);
  assert.equal(slots[0]!.title, "Best Bet");
});
