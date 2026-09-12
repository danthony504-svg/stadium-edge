import assert from "node:assert/strict";
import test from "node:test";

import {
  coachBuildSports,
  focalSportsFromText,
  prioritySportsForAsk,
} from "./chatContextPriority.ts";

const ALL_SPORTS = [
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

test("Collage Football ask focalizes ncaaf (phone typo regression)", () => {
  const focal = focalSportsFromText("6 leg Collage Football");
  assert.ok(focal.has("ncaaf"), `expected ncaaf in ${[...focal]}`);
  assert.equal(focal.size, 1);
});

test("college football ask scopes Coach board to ncaaf only", () => {
  const sports = coachBuildSports("6 leg Collage Football", 6, ALL_SPORTS);
  assert.deepEqual(sports, ["ncaaf"]);
});

test("CFB ask must not inject NFL via priority sports", () => {
  const priority = prioritySportsForAsk("6 leg college football");
  assert.deepEqual([...priority], ["ncaaf"]);
  assert.ok(!priority.includes("nfl"));
});

test("generic ask keeps NFL+NCAAF priority inject", () => {
  assert.deepEqual([...prioritySportsForAsk("6 leg parlay")], ["nfl", "ncaaf"]);
});

test("mostly baseball soft-pref keeps MLB first but still loads football", () => {
  const ask = "10 leg mostly baseball";
  const sports = coachBuildSports(ask, 10, ALL_SPORTS);
  assert.ok(sports.includes("mlb"));
  assert.ok(sports.includes("nfl"), `expected nfl in ${sports}`);
  assert.ok(sports.includes("ncaaf"), `expected ncaaf in ${sports}`);
  assert.ok(sports.indexOf("mlb") < sports.indexOf("nfl"));
});

test("mostly baseball still allows NFL/NCAAF priority inject", () => {
  assert.deepEqual([...prioritySportsForAsk("10 leg mostly baseball")], ["nfl", "ncaaf"]);
});

test("hard MLB-only ask stays exclusive (no soft expand)", () => {
  assert.deepEqual(coachBuildSports("10 leg mlb", 10, ALL_SPORTS), ["mlb"]);
  assert.deepEqual(coachBuildSports("10 leg only baseball", 10, ALL_SPORTS), ["mlb"]);
  assert.deepEqual([...prioritySportsForAsk("10 leg mlb")], []);
});
