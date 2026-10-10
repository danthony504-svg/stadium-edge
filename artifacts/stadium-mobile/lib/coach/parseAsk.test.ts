import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpenCoachParlayAsk,
  isParlayBuildAsk,
  parseRequestedLegs,
  resolveBuildLegTarget,
  normalizeCoachLegTypos,
  coachPropsAskGameLineMismatchNote,
} from "./parseAsk.ts";

test("parseRequestedLegs reads N-leg asks", () => {
  assert.equal(parseRequestedLegs("Build a 6-leg parlay"), 6);
  assert.equal(parseRequestedLegs("give me 10 legs tonight"), 10);
  assert.equal(parseRequestedLegs("best MLB bets"), 0);
});

test("parseRequestedLegs accepts lag typo so board scan still runs", () => {
  assert.equal(parseRequestedLegs("7 lag"), 7);
  assert.equal(parseRequestedLegs("7 lags"), 7);
  assert.equal(isParlayBuildAsk("7 lag"), true);
  assert.equal(resolveBuildLegTarget("7 lag"), 7);
});

test("normalizeCoachLegTypos maps 9 lag → 9 leg for props-only parsers", () => {
  assert.equal(normalizeCoachLegTypos("9 lag NFL player prop"), "9 leg NFL player prop");
  assert.equal(normalizeCoachLegTypos("10 lags nfl props"), "10 leg nfl props");
});

test("phone: team prop ask does NOT claim player-props mismatch", () => {
  // Phone: "4 leg NHL team prop" correctly staged spreads, but note said
  // "You asked for player props".
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: "4 leg NHL team prop",
      propsOnly: false,
      picks: [
        { isProp: false, market: "Spread" },
        { isProp: false, market: "Alt Spread" },
        { isProp: false, market: "Puck Line" },
        { isProp: false, market: "Moneyline" },
      ],
    }),
    "",
  );
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: "5 leg NHL team props",
      propsOnly: false,
      picks: [{ isProp: false, market: "Spread" }],
    }),
    "",
  );
});

test("phone: mixed sports mix ticket does NOT claim player-props mismatch", () => {
  // Phone: "9 leg tonight mixed sports" staged props+game lines (correct mix)
  // but still showed PROPS_ASK_GOT_GAME_LINES.
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: "9 leg tonight mixed sports",
      propsOnly: false,
      picks: [
        { isProp: false, market: "Q2 Spread" },
        { isProp: false, market: "Q4 Spread" },
        { isProp: true, market: "Total Bases" },
        { isProp: false, market: "F5 Run Line" },
        { isProp: false, market: "Total" },
        { isProp: true, market: "Home Runs" },
        { isProp: true, market: "Points" },
        { isProp: true, market: "Rec Yds" },
        { isProp: false, market: "Spread" },
      ],
    }),
    "",
  );
});

test("phone spreads-not-props: lag + player prop ask mismatch note", () => {
  const note = coachPropsAskGameLineMismatchNote({
    askText: "9 lag NFL player prop",
    propsOnly: false,
    picks: [
      { isProp: false, market: "1H ALT SPREAD" },
      { isProp: false, market: "Q2 SPREAD" },
      { isProp: false, market: "TOTAL" },
    ],
  });
  assert.match(note, /You asked for player props/);
  assert.match(note, /team game lines/);
  assert.doesNotMatch(note, /PROPS_ASK_GOT_GAME_LINES/);
  assert.doesNotMatch(note, /\[/);
  assert.equal(
    coachPropsAskGameLineMismatchNote({
      askText: "9 lag NFL player prop",
      propsOnly: true,
      picks: [{ isProp: true, market: "PASSING YARDS" }, { isProp: true, market: "RUSHING YARDS" }],
    }),
    "",
  );
});

test("phone: player prop + teams still gets why when spreads stage", () => {
  const note = coachPropsAskGameLineMismatchNote({
    askText: "player props for bears and broncos",
    propsOnly: false,
    picks: [
      { isProp: true, market: "1H ALT TOTAL" }, // mis-flagged — market still counts as game line
      { isProp: false, market: "Q1 ALT SPREAD" },
    ],
  });
  assert.match(note, /You asked for player props/);
  assert.doesNotMatch(note, /PROPS_ASK_GOT_GAME_LINES/);
  assert.doesNotMatch(note, /\[/);
});

test("isParlayBuildAsk detects build intent", () => {
  assert.equal(isParlayBuildAsk("build me a parlay"), true);
  assert.equal(isParlayBuildAsk("6-leg NFL ticket"), true);
  assert.equal(isParlayBuildAsk("who wins tonight"), false);
});

test("isOpenCoachParlayAsk allows 1–15 legs without subscription", () => {
  for (const n of [1, 2, 5, 9, 15]) {
    assert.equal(isOpenCoachParlayAsk(`${n} leg parlay`), true, String(n));
    assert.equal(resolveBuildLegTarget(`${n} leg parlay`), n, String(n));
  }
  assert.equal(isOpenCoachParlayAsk("who wins tonight"), false);
  assert.equal(resolveBuildLegTarget("20 leg parlay"), 15);
  assert.equal(isOpenCoachParlayAsk("20 leg parlay"), true);
});

test("give me N UFC/tennis picks resolves legs for every N 2–15", () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    for (const sport of ["UFC", "tennis", "mma"]) {
      const ask = `give me ${n} ${sport} picks`;
      assert.equal(parseRequestedLegs(ask), n, ask);
      assert.equal(resolveBuildLegTarget(ask), n, ask);
      assert.equal(isParlayBuildAsk(ask), true, ask);
    }
    assert.equal(parseRequestedLegs(`give me ${n} UFC picks tonight`), n);
    assert.equal(parseRequestedLegs(`give me ${n} tennis picks tomorrow`), n);
  }
  // Unaffected sports still work.
  assert.equal(parseRequestedLegs("give me 5 NFL picks"), 5);
  assert.equal(parseRequestedLegs("give me 6 soccer picks"), 6);
});

test("bare N picks + slate day parses leg count (mix path, not freeform)", () => {
  for (const n of [3, 5, 9, 12, 15]) {
    const ask = `${n} picks tonight`;
    assert.equal(parseRequestedLegs(ask), n, ask);
    assert.equal(resolveBuildLegTarget(ask), n, ask);
    assert.equal(isParlayBuildAsk(ask), true, ask);
  }
});

test("N prop-family asks parse leg count without the word leg", () => {
  assert.equal(parseRequestedLegs("4 player props tonight"), 4);
  assert.equal(parseRequestedLegs("3 touchdowns tonight"), 3);
  assert.equal(parseRequestedLegs("6 home runs tonight"), 6);
  assert.equal(parseRequestedLegs("5 receiving yards props tonight"), 5);
  assert.equal(resolveBuildLegTarget("4 player props tonight"), 4);
});

test("resolveBuildLegTarget defaults build asks to 6", () => {
  assert.equal(resolveBuildLegTarget("build a parlay"), 6);
  assert.equal(resolveBuildLegTarget("8 leg NBA"), 8);
  assert.equal(resolveBuildLegTarget("injury report"), 0);
});
