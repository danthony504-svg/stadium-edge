import assert from "node:assert/strict";
import test from "node:test";

import {
  askNamesTeamGame,
  coachAskTeamMissNote,
  coachAskTeamScope,
  coachAskTeamShortfallNote,
  buildCoachTeamGameScopeDiagnostics,
  extractTeamPhraseFromLegAsk,
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

test("Chelsea / Ohio State exclusions: negative ≠ positive; entire matchup drops", () => {
  // Positive include
  const chelseaInc = coachAskTeamScope("5 leg Chelsea");
  assert.ok(chelseaInc);
  assert.equal(chelseaInc!.sport, "soccer");
  assert.ok(chelseaInc!.matchTokens.includes("chelsea"));
  assert.equal(excludedTeamScopesFromText("5 leg Chelsea").length, 0);

  // Negative exclusion
  for (const ask of [
    "5 leg SOCCER no Chelsea",
    "5 leg SOCCER not Chelsea",
    "5 SOCCER picks without the Chelsea",
    "6 leg soccer tonight no Chelsea",
  ]) {
    assert.equal(coachAskTeamScope(ask), null, `include must be null: ${ask}`);
    const ex = excludedTeamScopesFromText(ask);
    assert.ok(ex.length >= 1, ask);
    assert.ok(ex.some((e) => e.sport === "soccer" && e.matchTokens.includes("chelsea")), ask);
  }

  for (const ask of [
    "5 leg NCAAF no Ohio State",
    "5 leg NCAAF not Ohio State",
    "5 NCAAF picks without the Ohio State",
    "6 leg NCAAF no Buckeyes",
  ]) {
    assert.equal(coachAskTeamScope(ask), null, ask);
    const ex = excludedTeamScopesFromText(ask);
    assert.ok(ex.length >= 1, ask);
    assert.ok(
      ex.some(
        (e) =>
          e.sport === "ncaaf" &&
          (e.matchTokens.includes("ohio state") || e.matchTokens.includes("buckeyes")),
      ),
      ask,
    );
  }

  // Entire matchup excluded (PR #609 invariant)
  const ex = excludedTeamScopesFromText("5 leg SOCCER no Chelsea");
  const games = [
    { sport: "soccer", awayTeam: "Chelsea", homeTeam: "Arsenal" },
    { sport: "soccer", awayTeam: "Liverpool", homeTeam: "Manchester City" },
  ];
  const filtered = filterOddsGamesExcludingTeams(games, ex);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.awayTeam, "Liverpool");

  // Multiple exclusions
  const multi = excludedTeamScopesFromText("8 leg soccer no Chelsea no Arsenal");
  assert.ok(multi.length >= 2);
  assert.ok(multi.some((e) => e.matchTokens.includes("chelsea")));
  assert.ok(multi.some((e) => e.matchTokens.includes("arsenal")));
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

test("4 leg Troy → NCAAF Troy Trojans only (no MLB / other CFB / USC)", () => {
  const ask = "4 leg Troy";
  assert.equal(parseRequestedLegs(ask), 4);
  assert.equal(resolveBuildLegTarget(ask), 4);
  assert.deepEqual([...focalSportsFromText(ask)], ["ncaaf"]);
  assert.deepEqual(coachBoardSportsForAsk(ask, 4, ALL), ["ncaaf"]);
  const scope = coachAskTeamScope(ask);
  assert.ok(scope);
  assert.equal(scope!.sport, "ncaaf");
  assert.equal(scope!.parsedTeam, "troy");
  assert.match(String(scope!.displayName), /Troy/i);
  assert.ok(scope!.matchTokens.includes("troy"));
  assert.ok(!scope!.matchTokens.includes("trojans")); // avoid USC collision

  const games = [
    { id: "mlb1", sport: "mlb", awayTeam: "Cleveland Guardians", homeTeam: "Chicago White Sox" },
    { id: "mlb2", sport: "mlb", awayTeam: "Los Angeles Dodgers", homeTeam: "Atlanta Braves" },
    {
      id: "ncaaf-other",
      sport: "ncaaf",
      awayTeam: "New Mexico State Aggies",
      homeTeam: "Florida International Panthers",
    },
    {
      id: "troy-game",
      sport: "ncaaf",
      awayTeam: "Southern Mississippi Golden Eagles",
      homeTeam: "Troy Trojans",
      homeTeamId: "2653",
      awayTeamId: "2572",
    },
    {
      id: "usc",
      sport: "ncaaf",
      awayTeam: "USC Trojans",
      homeTeam: "UCLA Bruins",
    },
  ];
  const filtered = filterOddsGamesForAskTeam(games, scope);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.id, "troy-game");

  const picks = filterPicksForAskTeam(
    [
      { sport: "mlb", game: "Cleveland Guardians @ Chicago White Sox", market: "Spread", pick: "Sox +1.5" },
      {
        sport: "mlb",
        game: "Los Angeles Dodgers @ Atlanta Braves",
        market: "Total Bases",
        pick: "Ronald Acuna Jr. Under 1.5 Total Bases",
      },
      {
        sport: "ncaaf",
        game: "New Mexico State Aggies @ Florida International Panthers",
        market: "Total",
        pick: "Over 47",
      },
      {
        sport: "ncaaf",
        game: "Southern Mississippi Golden Eagles @ Troy Trojans",
        market: "Spread",
        pick: "Troy Trojans -10.5",
      },
      {
        sport: "ncaaf",
        game: "Southern Mississippi Golden Eagles @ Troy Trojans",
        market: "Moneyline",
        pick: "Troy Trojans ML",
      },
      {
        sport: "ncaaf",
        game: "Southern Mississippi Golden Eagles @ Troy Trojans",
        market: "Total",
        pick: "Under 49.5",
      },
      {
        sport: "ncaaf",
        game: "Southern Mississippi Golden Eagles @ Troy Trojans",
        market: "1H Spread",
        pick: "Troy Trojans -6.5",
      },
      {
        sport: "ncaaf",
        game: "USC Trojans @ UCLA Bruins",
        market: "Spread",
        pick: "USC Trojans -7",
      },
    ],
    scope,
  );
  assert.equal(picks.length, 4);
  assert.ok(picks.every((p) => /Troy Trojans/i.test(String(p.game))));
  assert.ok(picks.every((p) => p.sport === "ncaaf"));

  const diag = buildCoachTeamGameScopeDiagnostics({
    requestedLegs: 4,
    scope,
    gamesBeforeFilter: games.filter((g) => g.sport === "ncaaf"),
    gamesAfterFilter: filtered,
    finalLegCount: 4,
  });
  assert.equal(diag.parsedTeam, "troy");
  assert.equal(diag.resolvedSport, "ncaaf");
  assert.equal(diag.resolvedLeague, "NCAAF");
  assert.equal(diag.resolvedTeamId, "2653");
  assert.equal(diag.resolvedGameId, "troy-game");
  assert.equal(diag.candidateCountBeforeGameFilter, 3);
  assert.equal(diag.candidateCountAfterGameFilter, 1);
  assert.equal(diag.finalLegCount, 4);
});

test("4 leg Troy Trojans phrase also scopes NCAAF", () => {
  const scope = coachAskTeamScope("4 leg Troy Trojans");
  assert.ok(scope);
  assert.equal(scope!.sport, "ncaaf");
  assert.ok(scope!.matchTokens.includes("troy"));
});

test("bare 4 leg Trojans stays unresolved (USC ambiguity)", () => {
  assert.equal(coachAskTeamScope("4 leg Trojans"), null);
});

test("Troy shortfall note does not invite other games", () => {
  const scope = coachAskTeamScope("4 leg Troy");
  assert.match(coachAskTeamShortfallNote(scope, 4, 2, 1), /Troy/i);
  assert.match(coachAskTeamShortfallNote(scope, 4, 2, 1), /won't fill/i);
  assert.equal(coachAskTeamShortfallNote(scope, 4, 4, 1), "");
});
