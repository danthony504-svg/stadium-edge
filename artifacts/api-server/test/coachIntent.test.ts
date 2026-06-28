import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCoachRecommendationQuestion,
  looksLikeComparisonNameMash,
  shouldBlockPlayerSearch,
} from "../src/lib/coachIntent.ts";

test("player-search blocks comparison name mash", () => {
  assert.equal(
    looksLikeComparisonNameMash("willy adames heliot ramos"),
    true,
  );
  assert.equal(looksLikeComparisonNameMash("Willy Adames"), false);
});

test("mash subqueries are blocked after a mash query", () => {
  assert.equal(shouldBlockPlayerSearch("willy adames heliot ramos"), true);
  assert.equal(shouldBlockPlayerSearch("willy adames"), true);
  assert.equal(shouldBlockPlayerSearch("heliot ramos"), true);
});

test("raw comparison message is detected", () => {
  assert.equal(
    isCoachRecommendationQuestion("willy adames or heliot ramos to hit a HR?"),
    true,
  );
});
