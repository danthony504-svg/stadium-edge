import assert from "node:assert/strict";
import test from "node:test";
import type { CombinedPickScore } from "./pickScore.ts";
import {
  buildPropDualVerdict,
  computeMatchupScore,
  computePlayerScore,
  computePropDualScore,
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

test("buildPropDualVerdict: hot player + tough matchup", () => {
  const v = buildPropDualVerdict(72, 40);
  assert.equal(v.recommends, false);
  assert.equal(v.headline, "Pass");
  assert.match(v.explanation, /Hot player, but tough matchup/);
});

test("buildPropDualVerdict: great matchup + cold player", () => {
  const v = buildPropDualVerdict(38, 74);
  assert.equal(v.recommends, false);
  assert.match(v.explanation, /Great matchup, but player is cold/);
});

test("buildPropDualVerdict: both clear the bar", () => {
  const v = buildPropDualVerdict(60, 58);
  assert.equal(v.recommends, true);
  assert.equal(v.headline, "Recommend");
});

test("computePlayerScore: cold recent form drags score down", () => {
  const { score } = computePlayerScore({
    combined: mockCombined({ grade: "D", composite: 4.5, confidencePct: 42, edgePct: -1 }),
    simRow: null,
    projection: 0.1,
    line: 0.5,
    side: "Over",
    hitPct: 10,
  });
  assert.ok(score != null);
  assert.ok(score < MIN_PLAYER_SCORE);
});

test("computeMatchupScore: MLB HR market uses pitcher and park signals", () => {
  const { score, factors } = computeMatchupScore({
    sport: "mlb",
    marketKey: "batter_home_runs",
    mlb: {
      pitcher: {
        name: "Soft Toss",
        hrPer9: 1.6,
        oppOPS: 0.82,
        kPer9: 7,
        barrelPctAllowed: 12,
        hardHitPctAllowed: 45,
        flyBallPct: 42,
        battedBallEvents: 120,
        throws: "R",
      },
      ballpark: { hrIndex: 112, tempF: 82, dome: false, venue: "Test Park" },
      platoon: { ops: 0.88, hand: "RHP", bats: "L" },
    },
  });
  assert.ok(score != null);
  assert.ok(score >= MIN_MATCHUP_SCORE);
  assert.ok(factors.some((f) => f.key === "hr9" || f.key === "pitcher"));
});

test("computePropDualScore: Jordan Walker pattern — great HR spot, cold batter", () => {
  const dual = computePropDualScore(
    {
      combined: mockCombined({ grade: "D", composite: 4.8, confidencePct: 48 }),
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

test("propDualScoreRecommends: requires B+ even when dual scores pass", () => {
  const dual = computePropDualScore(
    {
      combined: mockCombined({ grade: "C", composite: 6.2 }),
      simRow: null,
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
  assert.equal(dual.recommends, true);
  assert.equal(propDualScoreRecommends(dual), false);
});
