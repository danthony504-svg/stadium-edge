import assert from "node:assert/strict";
import test from "node:test";
import { isBinaryNullLineMarket } from "./binaryPropMarket.ts";
import { normalizePropsOnlyPick } from "./coachFootballPropsOnlyGrade.ts";
import { fetchFullBoardPropPool } from "./api.ts";
import { isFootballPropsOnlyCandidate } from "./coachFootballPropsOnly.ts";

test("binary football, basketball and soccer markets normalize genuine Yes/No to 0.5 only", () => {
  for (const key of ["player_anytime_td", "player_first_td", "player_double_double", "player_goal_scorer_anytime", "player_first_goal_scorer"]) {
    assert.equal(isBinaryNullLineMarket(key), true);
    const p = normalizePropsOnlyPick({ propMarketKey: key, propLine: null, propSide: "No" } as never);
    assert.equal(p.propLine, 0.5);
    assert.equal(p.propSide, "Under");
    if (key === "player_first_td" || key === "player_first_goal_scorer") {
      assert.equal(isFootballPropsOnlyCandidate({ ...p, isProp: true, odds: 300, athleteId: "a", sport: "nfl" } as never), false);
    }
  }
  for (const key of ["player_rush_yds", "player_points", "batter_home_runs", "player_pass_tds"]) {
    assert.equal(isBinaryNullLineMarket(key), false);
    assert.equal(normalizePropsOnlyPick({ propMarketKey: key, propLine: null } as never).propLine, null);
  }
});

test("full-board conversion keeps a posted binary No price instead of dropping its null threshold", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ props: [
    { player: "Scorer", market: "player_anytime_td", line: null, overPrice: 140, underPrice: -170, athleteId: "scorer", playerTeamId: "28" },
    { player: "Missing threshold", market: "player_rush_yds", line: null, underPrice: -110, athleteId: "other", playerTeamId: "28" },
  ] }), { headers: { "content-type": "application/json" } });
  try {
    const games = [{ sport: "nfl", homeTeam: "San Francisco 49ers", awayTeam: "Washington Commanders", homeTeamId: "25", awayTeamId: "28", homeAbbr: "SF", awayAbbr: "WSH" }];
    const pool = await fetchFullBoardPropPool([{ id: "event", sport: "nfl", homeTeam: "San Francisco 49ers", awayTeam: "Washington Commanders" }] as never, games as never, []);
    assert.deepEqual(pool.map(p => [p.player, p.side, p.line, p.odds]), [["Scorer", "Over", null, 140], ["Scorer", "Under", null, -170]]);
  } finally { globalThis.fetch = oldFetch; }
});
