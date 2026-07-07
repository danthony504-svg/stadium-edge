import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCoachRecommendationQuestion,
  isPitcherInningsWorkloadAsk,
  parseStatLookup,
} from "./statLookup.ts";

test("isCoachRecommendationQuestion flags either-or HR comparison asks", () => {
  assert.equal(isCoachRecommendationQuestion("willy adames or heliot ramos to hit a HR?"), true);
  assert.equal(isCoachRecommendationQuestion("Curry or LeBron to score more tonight"), true);
});

test("isCoachRecommendationQuestion does not flag pure stat lookups", () => {
  assert.equal(isCoachRecommendationQuestion("Willy Adames HR last 10 games"), false);
  assert.equal(isCoachRecommendationQuestion("show me Adames stats"), false);
});

test("parseStatLookup returns null for either-or recommendation asks", () => {
  assert.equal(parseStatLookup("willy adames or heliot ramos to hit a HR?"), null);
});

test("isPitcherInningsWorkloadAsk distinguishes workload from period splits", () => {
  assert.equal(isPitcherInningsWorkloadAsk("How many innings will skenes play today?"), true);
  assert.equal(isPitcherInningsWorkloadAsk("how many innings will Paul Skenes pitch tonight"), true);
  assert.equal(isPitcherInningsWorkloadAsk("Skenes 1st inning strikeouts"), false);
  assert.equal(isPitcherInningsWorkloadAsk("F5 total for Cubs game"), false);
});

test("parseStatLookup maps innings workload to IP without period flag", () => {
  const q = parseStatLookup("How many innings will skenes play today?");
  assert.ok(q);
  assert.equal(q!.name.toLowerCase(), "skenes");
  assert.equal(q!.period, false);
  assert.deepEqual(q!.statCols, ["IP"]);
  assert.equal(q!.statWord, "innings pitched");
});
