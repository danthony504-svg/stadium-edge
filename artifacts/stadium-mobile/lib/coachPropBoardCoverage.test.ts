import assert from "node:assert/strict";
import test from "node:test";

import {
  coachBoardSportsForAsk,
  EXPECTED_MAIN_PROP_FAMILIES,
  isPlayerPropSport,
  PLAYER_PROP_SPORTS,
  propPoolCoversPostedPropSports,
} from "./coachPropBoardCoverage.ts";

const ALL = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "nfl",
  "ncaaf",
  "ncaab",
];

test("PLAYER_PROP_SPORTS is every league with Odds player props (not UFC/tennis)", () => {
  assert.deepEqual([...PLAYER_PROP_SPORTS].sort(), [
    "mlb",
    "nba",
    "ncaab",
    "ncaaf",
    "nfl",
    "nhl",
    "soccer",
    "wnba",
  ]);
  assert.equal(isPlayerPropSport("ufc"), false);
  assert.equal(isPlayerPropSport("tennis"), false);
  assert.equal(isPlayerPropSport("mlb"), true);
  assert.equal(isPlayerPropSport("ncaab"), true);
});

test("generic 6-leg ask loads every prop-capable sport including ncaab", () => {
  const sports = coachBoardSportsForAsk("6 leg", 6, ALL);
  for (const s of PLAYER_PROP_SPORTS) {
    assert.ok(sports.includes(s), `generic 6-leg board must include ${s}`);
  }
});

test("named CFB ask stays ncaaf-only (does not fan out all prop sports)", () => {
  assert.deepEqual(coachBoardSportsForAsk("6 leg Collage Football", 6, ALL), ["ncaaf"]);
  assert.deepEqual(coachBoardSportsForAsk("6 leg college football", 6, ALL), ["ncaaf"]);
});

test("mostly baseball board still considers football props (soft preference)", () => {
  const sports = coachBoardSportsForAsk("10 leg mostly baseball", 10, ALL);
  assert.ok(sports.includes("mlb"));
  assert.ok(sports.includes("nfl"), `expected nfl in ${sports}`);
  assert.ok(sports.includes("ncaaf"), `expected ncaaf in ${sports}`);
  // Soft prefs also union the rest of the prop board (same as generic).
  assert.ok(sports.includes("ncaab"));
});

test("expected main prop families cover combo / rush / points-style markets", () => {
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.mlb!.includes("batter_hits_runs_rbis"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.nfl!.includes("player_rush_yds"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.nfl!.includes("player_sacks"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.nfl!.includes("player_pass_tds"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.ncaaf!.includes("player_anytime_td"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.ncaaf!.includes("player_pass_tds"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.nba!.includes("player_points"));
  assert.ok(EXPECTED_MAIN_PROP_FAMILIES.ncaab!.includes("player_points"));
});

test("propPoolCoversPostedPropSports fails when a posted prop sport is missing from pool", () => {
  assert.equal(
    propPoolCoversPostedPropSports(["mlb", "nfl", "ufc"], ["mlb", "nfl"]),
    true,
  );
  assert.equal(
    propPoolCoversPostedPropSports(["mlb", "ncaab"], ["mlb"]),
    false,
  );
});
