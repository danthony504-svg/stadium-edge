import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionsPropIntent, wantsPropsOnly, explicitSingleGameIntent, tonightExhaustedNote, wantsTonightSlate, threadWantsTonightSlate, filterTonightSlatePicks, localDayDiff, wantsTomorrowSlate, threadWantsTomorrowSlate, slateDayFromThread, slateOddsLabel, filterTomorrowSlatePicks, filterPicksForSlateDay } from "./slate.ts";

// A GENERIC parlay ask carries no prop words, so the today-only salvage and the
// reach-count backfill are both allowed to fill from real GAME-LEVEL mains.
test("generic parlay asks => false (game-main fill allowed)", () => {
  assert.equal(mentionsPropIntent("Build me a 7 leg soccer parlay for today"), false);
  assert.equal(mentionsPropIntent("6-leg parlay for tonight"), false);
  assert.equal(mentionsPropIntent("give me a safe 3 leg ticket"), false);
  assert.equal(mentionsPropIntent(""), false);
  assert.equal(mentionsPropIntent(null), false);
});

// Explicit prop / prop-market asks => true, so neither fill silently turns a
// props ticket into game moneylines.
test("explicit prop intent => true", () => {
  assert.equal(mentionsPropIntent("player props only"), true);
  assert.equal(mentionsPropIntent("give me some prop bets"), true);
  assert.equal(mentionsPropIntent("6 home run hitters today"), true);
  assert.equal(mentionsPropIntent("strikeout parlay"), true);
  assert.equal(mentionsPropIntent("anytime TD parlay"), true);
  assert.equal(mentionsPropIntent("3 shots on target legs"), true);
});

// Points-as-prop phrasing (a number/leg/over-under near "points") => true.
test("points-as-prop phrasing => true", () => {
  assert.equal(mentionsPropIntent("over 25.5 points parlay"), true);
  assert.equal(mentionsPropIntent("3 legs of player points"), true);
});

test("wantsPropsOnly: explicit-only phrasing, not mixed with-props phrasing", () => {
  assert.equal(wantsPropsOnly("Build me a 15 leg with player props"), false);
  assert.equal(wantsPropsOnly("player props only parlay"), true);
  assert.equal(wantsPropsOnly("6 leg strikeout parlay"), true);
  assert.equal(wantsPropsOnly("Build me a 7 leg soccer parlay for today"), false);
  assert.equal(wantsPropsOnly("6-leg parlay for tonight"), false);
});

test("explicitSingleGameIntent: generic tonight parlay is NOT single-game", () => {
  assert.equal(explicitSingleGameIntent("Build me a 15-leg longshot parlay for tonight"), false);
  assert.equal(explicitSingleGameIntent("6-leg parlay for tonight"), false);
  assert.equal(explicitSingleGameIntent("same game parlay for Yankees @ Red Sox"), true);
  assert.equal(explicitSingleGameIntent("build a 6 leg for Yankees vs Red Sox"), true);
});

test("tonightExhaustedNote: blocks silent tomorrow padding when tonight slate is gone", () => {
  const { tonightExhaustedNote } = await import("./slate.ts");
  assert.match(
    tonightExhaustedNote({
      tonightRequested: true,
      todayOnlyApplied: false,
      surviving: 0,
      requestedLegs: 15,
    }),
    /tomorrow/i,
  );
  assert.equal(
    tonightExhaustedNote({
      tonightRequested: true,
      todayOnlyApplied: true,
      surviving: 0,
      requestedLegs: 15,
    }),
    "",
  );
});

test("wantsTonightSlate: bare N-leg parlay defaults to tonight", () => {
  assert.equal(wantsTonightSlate("Build me a 5-leg parlay"), true);
  assert.equal(wantsTonightSlate("Build me the best parlay"), true);
  assert.equal(wantsTonightSlate("Build me a 5-leg parlay for tomorrow"), false);
  assert.equal(wantsTonightSlate("Build me a 5-leg parlay for tonight"), true);
});

test("slateDayFromThread: tomorrow beats tonight default", () => {
  assert.equal(slateDayFromThread("Build me a 8 leg for tomorrow", []), "tomorrow");
  assert.equal(slateDayFromThread("Build me the best parlay", []), "tonight");
  assert.equal(slateOddsLabel("tomorrow"), "tomorrow's");
});

test("filterTomorrowSlatePicks keeps only tomorrow kickoffs", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 35, 0, 0);
  const today = new Date();
  today.setHours(23, 0, 0, 0);
  if (today.getTime() <= Date.now()) today.setDate(today.getDate() + 1);
  const kept = filterPicksForSlateDay(
    [{ startsAt: tomorrow.toISOString() }, { startsAt: today.toISOString() }],
    "tomorrow",
  );
  assert.equal(kept.length, 1);
  assert.equal(localDayDiff(kept[0]!.startsAt!), 1);
});

test("threadWantsTonightSlate: inherits tonight from prior user turn", () => {
  assert.equal(
    threadWantsTonightSlate("make it safer", ["Build me a 6-leg parlay for tonight"]),
    true,
  );
  assert.equal(
    threadWantsTonightSlate("add one more leg", ["Build me a parlay for tomorrow"]),
    false,
  );
});

test("filterTonightSlatePicks drops tomorrow kickoffs", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 35, 0, 0);
  const kept = filterTonightSlatePicks([
    { startsAt: tomorrow.toISOString() },
    { startsAt: null },
  ]);
  assert.equal(kept.length, 0);
  assert.equal(localDayDiff(tomorrow.toISOString()), 1);
});
