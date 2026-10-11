import assert from "node:assert/strict";
import test from "node:test";

import {
  gameValueForMarket,
  isDiscreteCountMarket,
  isPeriodPropMarketKey,
} from "../src/lib/propStatValue.ts";

const NONE = new Set<string>();

const FOOTBALL_STATS = {
  passingYards: "278",
  passingAttempts: "35",
  completions: "24",
  passingTouchdowns: "2",
  interceptions: "1",
  longPassing: "47",
  rushingYards: "18",
  rushingAttempts: "4",
  longRushing: "11",
  rushingTouchdowns: "1",
  receivingYards: "96",
  receptions: "7",
  longReception: "31",
  receivingTouchdowns: "1",
  fieldGoalsMade: "2",
  FG: "2-3",
  extraPointsMade: "3",
  kickingPoints: "9",
};

test("football TD / combo / FG markets resolve from ESPN machine fields", () => {
  assert.equal(gameValueForMarket("player_anytime_td", FOOTBALL_STATS, NONE), 4);
  assert.equal(gameValueForMarket("player_first_td", FOOTBALL_STATS, NONE), 4);
  assert.equal(gameValueForMarket("player_rush_tds", FOOTBALL_STATS, NONE), 1);
  assert.equal(gameValueForMarket("player_reception_tds", FOOTBALL_STATS, NONE), 1);
  assert.equal(gameValueForMarket("player_pass_rush_yds", FOOTBALL_STATS, NONE), 296);
  assert.equal(gameValueForMarket("player_rush_reception_yds", FOOTBALL_STATS, NONE), 114);
  assert.equal(gameValueForMarket("player_pass_rush_reception_yds", FOOTBALL_STATS, NONE), 392);
  assert.equal(gameValueForMarket("player_rush_reception_tds", FOOTBALL_STATS, NONE), 2);
  assert.equal(gameValueForMarket("player_pass_rush_reception_tds", FOOTBALL_STATS, NONE), 4);
  assert.equal(gameValueForMarket("player_field_goals", FOOTBALL_STATS, NONE), 2);
  assert.equal(gameValueForMarket("player_kicking_points", FOOTBALL_STATS, NONE), 9);
});

test("MLB RBI / runs / pitcher outs", () => {
  assert.equal(gameValueForMarket("batter_rbis", { RBI: "2" }, NONE), 2);
  assert.equal(gameValueForMarket("batter_runs", { R: "1" }, NONE), 1);
  assert.equal(gameValueForMarket("batter_runs_scored", { R: "3" }, NONE), 3);
  assert.equal(gameValueForMarket("pitcher_outs", { OUTS: "18" }, NONE), 18);
  assert.equal(gameValueForMarket("pitcher_outs", { IP: "6.2" }, NONE), 20);
});

test("basketball double-double", () => {
  assert.equal(
    gameValueForMarket(
      "player_double_double",
      { PTS: "22", REB: "11", AST: "4", STL: "1", BLK: "0" },
      NONE,
    ),
    1,
  );
  assert.equal(
    gameValueForMarket(
      "player_double_double",
      { PTS: "18", REB: "8", AST: "4", STL: "1", BLK: "0" },
      NONE,
    ),
    0,
  );
});

test("soccer first goal scorer uses goals column", () => {
  assert.equal(gameValueForMarket("player_first_goal_scorer", { G: "1" }, NONE), 1);
  assert.equal(gameValueForMarket("player_goal_scorer_anytime", { G: "2" }, NONE), 2);
});

test("period markets fail closed — never grade full-game history", () => {
  assert.equal(isPeriodPropMarketKey("player_pass_yds_q1"), true);
  assert.equal(isPeriodPropMarketKey("player_points_h1"), true);
  assert.equal(isPeriodPropMarketKey("player_pass_yds"), false);
  assert.equal(gameValueForMarket("player_pass_yds_q1", FOOTBALL_STATS, NONE), null);
  assert.equal(gameValueForMarket("player_points_h1", { PTS: "28" }, NONE), null);
  assert.equal(isDiscreteCountMarket("player_anytime_td_q1"), false);
});

test("alternate suffix shares base mapping", () => {
  assert.equal(gameValueForMarket("player_pass_yds_alternate", FOOTBALL_STATS, NONE), 278);
  assert.equal(gameValueForMarket("player_anytime_td_alternate", FOOTBALL_STATS, NONE), 4);
});
