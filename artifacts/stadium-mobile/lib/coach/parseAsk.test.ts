import assert from "node:assert/strict";
import test from "node:test";

import {
  isParlayBuildAsk,
  parseRequestedLegs,
  resolveBuildLegTarget,
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

test("isParlayBuildAsk detects build intent", () => {
  assert.equal(isParlayBuildAsk("build me a parlay"), true);
  assert.equal(isParlayBuildAsk("6-leg NFL ticket"), true);
  assert.equal(isParlayBuildAsk("who wins tonight"), false);
});

test("resolveBuildLegTarget defaults build asks to 6", () => {
  assert.equal(resolveBuildLegTarget("build a parlay"), 6);
  assert.equal(resolveBuildLegTarget("8 leg NBA"), 8);
  assert.equal(resolveBuildLegTarget("injury report"), 0);
});
