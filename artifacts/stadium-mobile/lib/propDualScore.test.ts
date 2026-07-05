import assert from "node:assert/strict";
import test from "node:test";
import type { CombinedPickScore } from "./pickScore.ts";
import type { PropSimulationResult } from "./api.ts";
import {
  buildPropDualVerdict,
  computeFinalAiScore,
  computeMatchupScore,
  computePlayerScore,
  computePropDualScore,
  MIN_FINAL_AI_SCORE,
  MIN_MATCHUP_SCORE,
  MIN_PLAYER_SCORE,
  propDualScoreRecommends,
} from "./propDualScore.ts";

function mockCombined(overrides: Partial<CombinedPickScore> = {}): CombinedPickScore {
  return {
    scores: {
      matchup: 7,
      trend: 7,
      lineValue: 7,
      injury: 6,
      lineShopping: 6,
      simulation: 7,
      ...(overrides.scores ?? {}),
    },
    composite: overrides.composite ?? 8,
    grade: overrides.grade ?? "A-",
    confidencePct: overrides.confidencePct ?? 68,
    edgePct: overrides.edgePct ?? 3.5,
    ...overrides,
  };
}

function mockSim(hit = 0.58): PropSimulationResult {
  return {
    key: "k",
    player: "P",
    market: "m",
    line: 24.5,
    side: "Over",
    requestedSims: 10_000,
    completedSims: 10_000,
    failedSims: 0,
    actualSimCount: 10_000,
    startedAt: "",
    finishedAt: "",
    runTimeMs: 0,
    simulations: 10_000,
    hitProbability: hit,
    mostLikelyLine: 26,
    meanProjection: 26,
    medianProjection: 26,
    confidenceScore: 72,
    stdDev: null,
    sampleGames: 10,
    percentiles: null,
  };
}

test("buildPropDualVerdict: hot player + tough matchup", () => {
  const v = buildPropDualVerdict(72, 40, 58);
  assert.equal(v.recommends, false);
  assert.match(v.explanation, /Hot player, but tough matchup/);
});

test("buildPropDualVerdict: great matchup + cold player", () => {
  const v = buildPropDualVerdict(38, 74, 50);
  assert.equal(v.recommends, false);
  assert.match(v.explanation, /Great matchup, but player is cold/);
});

test("buildPropDualVerdict: all three scores pass", () => {
  const v = buildPropDualVerdict(60, 58, 62);
  assert.equal(v.recommends, true);
  assert.equal(v.passesFinalAi, true);
});

test("computePlayerScore: focuses on form, sim, confidence, projection — not grade", () => {
  const { score, factors } = computePlayerScore({
    combined: mockCombined({ grade: "D", composite: 4.5 }),
    simRow: null,
    projection: 0.1,
    line: 0.5,
    side: "Over",
    hitPct: 10,
  });
  assert.ok(score != null);
  assert.ok(score < MIN_PLAYER_SCORE);
  assert.ok(!factors.some((f) => f.key === "grade"));
  assert.ok(!factors.some((f) => f.key === "edge"));
});

test("computeMatchupScore: NBA uses pace and defense", () => {
  const { score, factors } = computeMatchupScore({
    sport: "nba",
    marketKey: "player_points",
    oppDefense: { pointsAgainst: 115, blocks: 4.5 },
    matchup: { homePace: 101, awayPace: 99 } as never,
    playerSide: "home",
    usageMinutes: 34,
  });
  assert.ok(score != null);
  assert.ok(factors.some((f) => f.key === "pace" || f.key === "defense"));
});

test("computeFinalAiScore: blends player, matchup, grade, edge", () => {
  const { score, factors } = computeFinalAiScore({
    playerScore: 62,
    matchupScore: 60,
    combined: mockCombined(),
    simRow: mockSim(),
    odds: -110,
  });
  assert.ok(score != null);
  assert.ok(score >= MIN_FINAL_AI_SCORE);
  assert.ok(factors.some((f) => f.key === "player"));
  assert.ok(factors.some((f) => f.key === "matchup"));
  assert.ok(factors.some((f) => f.key === "grade"));
  assert.ok(factors.some((f) => f.key === "edge"));
});

test("computePropDualScore: Jordan Walker pattern — great HR spot, cold batter", () => {
  const dual = computePropDualScore(
    {
      combined: mockCombined({ grade: "D", composite: 4.8, confidencePct: 48, edgePct: -1 }),
      simRow: null,
      projection: 0.05,
      line: 0.5,
      side: "Over",
      hitPct: 10,
    },
    {
      sport: "mlb",
      marketKey: "batter_home_runs",
      mlb: {
        pitcher: {
          name: "Soft Toss",
          hrPer9: 1.7,
          oppOPS: 0.84,
          kPer9: 6.5,
          barrelPctAllowed: 13,
          hardHitPctAllowed: 46,
          flyBallPct: 44,
          battedBallEvents: 100,
          throws: "R",
        },
        ballpark: { hrIndex: 115, tempF: 85, dome: false, venue: "Friendly Park" },
        platoon: { ops: 0.9, hand: "RHP", bats: "R" },
      },
    },
  );
  assert.equal(dual.recommends, false);
  assert.match(dual.explanation, /Great matchup, but player is cold/);
  assert.ok((dual.matchupScore ?? 0) >= MIN_MATCHUP_SCORE);
  assert.ok((dual.playerScore ?? 100) < MIN_PLAYER_SCORE);
});

test("propDualScoreRecommends: requires B+, edge, confidence, and sim", () => {
  const dual = computePropDualScore(
    {
      combined: mockCombined({ grade: "C", composite: 6.2, confidencePct: 48, edgePct: -0.5 }),
      simRow: mockSim(0.44),
      hitPct: 62,
      line: 20,
      side: "Over",
      projection: 24,
    },
    {
      sport: "nba",
      marketKey: "player_points",
      oppDefense: { pointsAgainst: 116 },
    },
  );
  assert.equal(propDualScoreRecommends(dual, mockSim(0.44), mockCombined({ grade: "C" })), false);
});

test("propDualScoreRecommends: strong pick passes all gates", () => {
  const combined = mockCombined();
  const sim = mockSim(0.58);
  const dual = computePropDualScore(
    {
      combined,
      simRow: sim,
      hitPct: 70,
      line: 20,
      side: "Over",
      projection: 26,
      odds: -110,
    },
    {
      sport: "nba",
      marketKey: "player_points",
      oppDefense: { pointsAgainst: 116 },
      matchup: { homePace: 102, awayPace: 100 } as never,
      playerSide: "home",
      usageMinutes: 35,
    },
  );
  assert.equal(propDualScoreRecommends(dual, sim, combined), true);
});
