import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionsPropIntent, wantsPropsOnly } from "./slate.ts";

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

test("wantsPropsOnly: explicit and N-leg-with-props phrasing", () => {
  assert.equal(wantsPropsOnly("Build me a 15 leg with player props"), true);
  assert.equal(wantsPropsOnly("player props only parlay"), true);
  assert.equal(wantsPropsOnly("6 leg strikeout parlay"), true);
  assert.equal(wantsPropsOnly("Build me a 7 leg soccer parlay for today"), false);
  assert.equal(wantsPropsOnly("6-leg parlay for tonight"), false);
});
