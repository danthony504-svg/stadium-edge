import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCoachRecommendationQuestion,
  looksLikeComparisonNameMash,
} from "../src/lib/coachIntent.ts";

test("player-search blocks comparison name mash", () => {
  assert.equal(
    looksLikeComparisonNameMash("willy adames heliot ramos"),
    true,
  );
  assert.equal(looksLikeComparisonNameMash("Willy Adames"), false);
});

test("raw comparison message is detected", () => {
  assert.equal(
    isCoachRecommendationQuestion("willy adames or heliot ramos to hit a HR?"),
    true,
  );
});
