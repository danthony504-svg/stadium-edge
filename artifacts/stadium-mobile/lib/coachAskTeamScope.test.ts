import assert from "node:assert/strict";
import test from "node:test";

import {
  askNamesTeamGame,
  coachAskTeamScope,
  filterOddsGamesForAskTeam,
  filterPicksForAskTeam,
  sportsFromAskTeamNicknames,
} from "./coachAskTeamScope.ts";
import {
  coachBuildSports,
  focalSportsFromText,
  prioritySportsForAsk,
} from "./chatContextPriority.ts";
import { coachBoardSportsForAsk } from "./coachPropBoardCoverage.ts";

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

test("screenshot ask: 7 leg saints game focalizes NFL only", () => {
  const ask = "7 leg saints game";
  assert.deepEqual([...focalSportsFromText(ask)], ["nfl"]);
  assert.deepEqual(coachBuildSports(ask, 7, ALL), ["nfl"]);
  assert.deepEqual(coachBoardSportsForAsk(ask, 7, ALL), ["nfl"]);
  assert.deepEqual([...prioritySportsForAsk(ask)], ["nfl"]);
  assert.ok(!focalSportsFromText(ask).has("mlb"));
});

test("saints nickname resolves team scope + game intent", () => {
  const scope = coachAskTeamScope("7 leg saints game");
  assert.ok(scope);
  assert.equal(scope!.sport, "nfl");
  assert.ok(scope!.matchTokens.includes("saints"));
  assert.equal(askNamesTeamGame("7 leg saints game"), true);
  assert.equal(askNamesTeamGame("7 leg saints"), false);
});

test("saints game filters out MLB Rays / Guardians legs", () => {
  const scope = coachAskTeamScope("7 leg saints game");
  const games = [
    { sport: "nfl", awayTeam: "Atlanta Falcons", homeTeam: "New Orleans Saints" },
    { sport: "mlb", awayTeam: "Houston Astros", homeTeam: "Tampa Bay Rays" },
  ];
  const filtered = filterOddsGamesForAskTeam(games, scope);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.homeTeam, "New Orleans Saints");

  const picks = filterPicksForAskTeam(
    [
      { sport: "mlb", game: "Houston Astros @ Tampa Bay Rays" },
      { sport: "nfl", game: "Atlanta Falcons @ New Orleans Saints" },
      { sport: "mlb", game: "Cleveland Guardians @ Minnesota Twins" },
    ],
    scope,
  );
  assert.equal(picks.length, 1);
  assert.match(String(picks[0]!.game), /Saints/i);
});

test("ambiguous giants alone does not lock a sport", () => {
  assert.equal(coachAskTeamScope("6 leg giants"), null);
  assert.equal(sportsFromAskTeamNicknames("6 leg giants").size, 0);
  assert.ok(coachAskTeamScope("6 leg ny giants")?.sport === "nfl");
  assert.ok(coachAskTeamScope("6 leg san francisco giants")?.sport === "mlb");
});

test("generic 7 leg still multi-sport (no team nickname)", () => {
  const ask = "7 leg parlay";
  assert.equal(focalSportsFromText(ask).size, 0);
  assert.ok(coachBoardSportsForAsk(ask, 7, ALL).includes("mlb"));
  assert.ok(coachBoardSportsForAsk(ask, 7, ALL).includes("nfl"));
});
