import assert from "node:assert/strict";
import test from "node:test";

import {
  askNamesTeamGame,
  coachAskTeamMissNote,
  coachAskTeamScope,
  excludedTeamScopesFromText,
  filterOddsGamesExcludingTeams,
  filterOddsGamesForAskTeam,
  filterPicksExcludingTeams,
  filterPicksForAskTeam,
  resolveExcludedTeamIdsFromGames,
  sportsFromAskTeamNicknames,
} from "./coachAskTeamScope.ts";
import { parseRequestedLegs, resolveBuildLegTarget } from "./coach/parseAsk.ts";
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

function ducksExcluded(ask: string) {
  assert.equal(parseRequestedLegs(ask), 6);
  assert.equal(resolveBuildLegTarget(ask), 6);
  const excluded = excludedTeamScopesFromText(ask);
  assert.ok(excluded.length >= 1, ask);
  const ducks = excluded.find(
    (e) => e.sport === "nhl" && e.matchTokens.includes("ducks"),
  );
  assert.ok(ducks, `expected ducks exclusion for: ${ask}`);
  assert.ok(ducks!.matchTokens.includes("anaheim"));
  assert.equal(coachAskTeamScope(ask), null, `negative must not include-scope: ${ask}`);
  assert.deepEqual(coachBoardSportsForAsk(ask, 6, ALL), ["nhl"]);
  return ducks!;
}

test("6 leg NHL not the Ducks → NHL only, Anaheim excluded, no include scope", () => {
  ducksExcluded("6 leg NHL not the Ducks");
});

test("6 leg NHL no Ducks → same Anaheim exclusion", () => {
  ducksExcluded("6 leg NHL no Ducks");
});

test("6 leg NHL exclude Anaheim → same Anaheim exclusion", () => {
  ducksExcluded("6 leg NHL exclude Anaheim");
});

test("6 leg NHL without Anaheim Ducks → same Anaheim exclusion", () => {
  ducksExcluded("6 leg NHL without Anaheim Ducks");
});

test("6 leg Ducks → positive Ducks scope remains functional", () => {
  const ask = "6 leg Ducks";
  const scope = coachAskTeamScope(ask);
  assert.ok(scope);
  assert.equal(scope!.sport, "nhl");
  assert.ok(scope!.matchTokens.includes("ducks"));
  assert.equal(excludedTeamScopesFromText(ask).length, 0);
  assert.deepEqual(coachBoardSportsForAsk(ask, 6, ALL), ["nhl"]);
});

test("7 leg NFL no Cowboys excludes entire Cowboys matchup (not include)", () => {
  const ask = "7 leg NFL no Cowboys";
  assert.equal(coachAskTeamScope(ask), null);
  const excluded = excludedTeamScopesFromText(ask);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0]!.sport, "nfl");
  assert.ok(excluded[0]!.matchTokens.includes("cowboys"));
  const games = [
    { sport: "nfl", awayTeam: "Dallas Cowboys", homeTeam: "New York Giants" },
    { sport: "nfl", awayTeam: "Philadelphia Eagles", homeTeam: "Washington Commanders" },
    { sport: "nfl", awayTeam: "Kansas City Chiefs", homeTeam: "Buffalo Bills" },
  ];
  const filtered = filterOddsGamesExcludingTeams(games, excluded);
  assert.equal(filtered.length, 2);
  assert.ok(!filtered.some((g) => /cowboys/i.test(`${g.awayTeam} ${g.homeTeam}`)));
});

test("10 leg NBA not Lakers excludes entire Lakers matchup", () => {
  const ask = "10 leg NBA not Lakers";
  assert.equal(coachAskTeamScope(ask), null);
  const excluded = excludedTeamScopesFromText(ask);
  assert.ok(excluded.some((e) => e.matchTokens.includes("lakers")));
  const games = [
    { sport: "nba", awayTeam: "Los Angeles Lakers", homeTeam: "Boston Celtics" },
    { sport: "nba", awayTeam: "Golden State Warriors", homeTeam: "Phoenix Suns" },
  ];
  assert.equal(filterOddsGamesExcludingTeams(games, excluded).length, 1);
  assert.equal(
    filterOddsGamesExcludingTeams(games, excluded)[0]!.awayTeam,
    "Golden State Warriors",
  );
});

test("5 leg MLB no Yankees or Dodgers excludes both matchups", () => {
  const ask = "5 leg MLB no Yankees or Dodgers";
  assert.equal(coachAskTeamScope(ask), null);
  const excluded = excludedTeamScopesFromText(ask);
  assert.equal(excluded.length, 2);
  assert.ok(excluded.some((e) => e.matchTokens.includes("yankees")));
  assert.ok(excluded.some((e) => e.matchTokens.includes("dodgers")));
  const games = [
    { sport: "mlb", awayTeam: "New York Yankees", homeTeam: "Boston Red Sox" },
    { sport: "mlb", awayTeam: "Los Angeles Dodgers", homeTeam: "San Diego Padres" },
    { sport: "mlb", awayTeam: "Chicago Cubs", homeTeam: "Atlanta Braves" },
  ];
  const filtered = filterOddsGamesExcludingTeams(games, excluded);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.awayTeam, "Chicago Cubs");
});

test("exclusion drops opponent player props, game lines, and alts from excluded matchup", () => {
  const excluded = excludedTeamScopesFromText("6 leg NHL not the ducks");
  const ducksGame = "Florida Panthers @ Anaheim Ducks";
  const otherGame = "Calgary Flames @ Seattle Kraken";
  const picks = filterPicksExcludingTeams(
    [
      { sport: "nhl", game: ducksGame, market: "POINTS", pick: "Tristan Luneau Over 0.5", isProp: true },
      { sport: "nhl", game: ducksGame, market: "POINTS", pick: "Brady Tkachuk Under 0.5", isProp: true },
      { sport: "nhl", game: ducksGame, market: "Moneyline", pick: "Florida Panthers", isProp: false },
      { sport: "nhl", game: ducksGame, market: "ALT TOTAL", pick: "Over 6.5", isProp: false },
      { sport: "nhl", game: otherGame, market: "POINTS", pick: "Player Over 0.5", isProp: true },
      { sport: "nhl", game: otherGame, market: "Puck Line", pick: "Seattle Kraken +1.5", isProp: false },
    ],
    excluded,
  );
  assert.equal(picks.length, 2);
  assert.ok(picks.every((p) => !/ducks|anaheim/i.test(String(p.game))));
});

test("recovery/top-up leftovers cannot reintroduce an excluded matchup", () => {
  const excluded = excludedTeamScopesFromText("6 leg NHL no Ducks");
  // Simulate scored leftovers that include the excluded event — staging belt must drop them.
  const leftovers = [
    { sport: "nhl", game: "Florida Panthers @ Anaheim Ducks", market: "ALT SPREAD", pick: "Ducks +2.5" },
    { sport: "nhl", game: "Vegas Golden Knights @ Vancouver Canucks", market: "TOTAL", pick: "Over 5.5" },
    { sport: "nhl", game: "Florida Panthers @ Anaheim Ducks", market: "POINTS", pick: "A.J. Greer Over 0.5" },
  ];
  const safe = filterPicksExcludingTeams(leftovers, excluded);
  assert.equal(safe.length, 1);
  assert.match(String(safe[0]!.game), /Canucks/i);
});

test("resolveExcludedTeamIdsFromGames attaches ESPN ids for excluded franchise", () => {
  const excluded = excludedTeamScopesFromText("6 leg NHL exclude Anaheim");
  const resolved = resolveExcludedTeamIdsFromGames(excluded, [
    {
      sport: "nhl",
      awayTeam: "Florida Panthers",
      homeTeam: "Anaheim Ducks",
      awayTeamId: "13",
      homeTeamId: "25",
    },
    {
      sport: "nhl",
      awayTeam: "Calgary Flames",
      homeTeam: "Seattle Kraken",
      awayTeamId: "20",
      homeTeamId: "55",
    },
  ]);
  assert.ok(resolved[0]!.teamIds.includes("25"));
  assert.ok(!resolved[0]!.teamIds.includes("13"));
});

test("anything but the Ducks parses as exclusion", () => {
  const excluded = excludedTeamScopesFromText("6 leg NHL anything but the Ducks");
  assert.ok(excluded.some((e) => e.matchTokens.includes("ducks")));
  assert.equal(coachAskTeamScope("6 leg NHL anything but the Ducks"), null);
});
