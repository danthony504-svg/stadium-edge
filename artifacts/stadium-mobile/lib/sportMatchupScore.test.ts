import assert from "node:assert/strict";
import test from "node:test";
import { buildSportMatchupFactors, weightedMatchupScore } from "./sportMatchupScore.ts";

test("MLB matchup includes pitcher, park, platoon", () => {
  const factors = buildSportMatchupFactors({
    sport: "mlb",
    marketKey: "batter_hits",
    mlb: {
      pitcher: { name: "A", hrPer9: 1.4, oppOPS: 0.8, kPer9: 8, throws: "R" },
      platoon: { ops: 0.85, hand: "RHP", bats: "L" },
      ballpark: { hrIndex: 108, tempF: 72, dome: false, venue: "Park" },
    },
  });
  assert.ok(factors.some((f) => f.key === "pitcher_hr9" || f.key === "pitcher_ops"));
  assert.ok(factors.some((f) => f.key === "platoon"));
  assert.ok(weightedMatchupScore(factors) != null);
});

test("NFL matchup includes defense and coverage proxies", () => {
  const factors = buildSportMatchupFactors({
    sport: "nfl",
    marketKey: "player_reception_yds",
    oppDefense: { pointsAgainst: 24, sacks: 42, interceptions: 12, passesDefended: 60 },
    playerSide: "away",
    matchup: {
      away: { avgMargin: 3.2 },
      homeRest: { restDays: 2, backToBack: false },
      awayRest: { restDays: 6, backToBack: false },
    } as never,
  });
  assert.ok(factors.some((f) => f.key === "defense"));
  assert.ok(factors.some((f) => f.key === "coverage" || f.key === "pressure"));
});

test("NHL matchup includes goalie signals", () => {
  const factors = buildSportMatchupFactors({
    sport: "nhl",
    marketKey: "player_points",
    oppDefense: { savePct: 0.905, goalsAgainstAvg: 2.9 },
    usageMinutes: 19,
  });
  assert.ok(factors.some((f) => f.key === "goalie"));
});

test("Soccer matchup includes goals-allowed proxy", () => {
  const factors = buildSportMatchupFactors({
    sport: "soccer",
    marketKey: "player_shots",
    oppDefense: { pointsAgainst: 1.4, cleanSheets: 8 },
  });
  assert.ok(factors.some((f) => f.key === "xg" || f.key === "defense"));
});
