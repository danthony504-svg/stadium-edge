import assert from "node:assert/strict";
import test from "node:test";

import {
  askNamesTeamGame,
  coachAskTeamMissNote,
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

test("screenshot ask: 6 leg Saints scopes NFL without requiring game", () => {
  const ask = "6 leg Saints";
  assert.deepEqual([...focalSportsFromText(ask)], ["nfl"]);
  assert.deepEqual(coachBoardSportsForAsk(ask, 6, ALL), ["nfl"]);
  const scope = coachAskTeamScope(ask);
  assert.ok(scope);
  assert.equal(scope!.sport, "nfl");
  assert.ok(scope!.matchTokens.includes("saints"));
  assert.equal(askNamesTeamGame(ask), true);
});

test("saints nickname resolves team scope with or without game word", () => {
  const withGame = coachAskTeamScope("7 leg saints game");
  assert.ok(withGame);
  assert.equal(withGame!.sport, "nfl");
  assert.ok(withGame!.matchTokens.includes("saints"));
  assert.equal(askNamesTeamGame("7 leg saints game"), true);
  assert.equal(askNamesTeamGame("6 leg Saints"), true);
});

test("saints ask filters out other NFL games (no silent slate fallback)", () => {
  const scope = coachAskTeamScope("6 leg Saints");
  const games = [
    { sport: "nfl", awayTeam: "Atlanta Falcons", homeTeam: "Pittsburgh Steelers" },
    { sport: "nfl", awayTeam: "Baltimore Ravens", homeTeam: "Indianapolis Colts" },
    { sport: "nfl", awayTeam: "Atlanta Falcons", homeTeam: "New Orleans Saints" },
    { sport: "mlb", awayTeam: "Houston Astros", homeTeam: "Tampa Bay Rays" },
  ];
  const filtered = filterOddsGamesForAskTeam(games, scope);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.homeTeam, "New Orleans Saints");

  const picks = filterPicksForAskTeam(
    [
      { sport: "nfl", game: "Atlanta Falcons @ Pittsburgh Steelers" },
      { sport: "nfl", game: "Baltimore Ravens @ Indianapolis Colts" },
      { sport: "nfl", game: "Green Bay Packers @ Minnesota Vikings" },
      { sport: "nfl", game: "Atlanta Falcons @ New Orleans Saints" },
    ],
    scope,
  );
  assert.equal(picks.length, 1);
  assert.match(String(picks[0]!.game), /Saints/i);
});

test("saints ask with no matching game stays empty (does not re-expand to Falcons)", () => {
  const scope = coachAskTeamScope("6 leg Saints");
  const games = [
    { sport: "nfl", awayTeam: "Atlanta Falcons", homeTeam: "Pittsburgh Steelers" },
    { sport: "nfl", awayTeam: "Baltimore Ravens", homeTeam: "Indianapolis Colts" },
  ];
  const filtered = filterOddsGamesForAskTeam(games, scope);
  assert.equal(filtered.length, 0);
  assert.equal(
    filterPicksForAskTeam(
      [
        { sport: "nfl", game: "Atlanta Falcons @ Pittsburgh Steelers" },
        { sport: "nfl", game: "Baltimore Ravens @ Indianapolis Colts" },
      ],
      scope,
    ).length,
    0,
  );
  assert.match(coachAskTeamMissNote(scope, 0), /saints/i);
  assert.match(coachAskTeamMissNote(scope, 0), /won't fill/i);
  assert.equal(coachAskTeamMissNote(scope, 1), "");
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
