import { test } from "node:test";
import assert from "node:assert/strict";
import { isCoachRecommendationQuestion, parseStatLookup } from "./statLookup.ts";

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
