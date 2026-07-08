import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCoachRecommendationQuestion,
  looksLikeComparisonNameMash,
  shouldBlockPlayerSearch,
  wantsSoccerScorerGoalkeeperPicks,
} from "../src/lib/coachIntent.ts";

test("player-search blocks comparison name mash", () => {
  assert.equal(
    looksLikeComparisonNameMash("willy adames heliot ramos"),
    true,
  );
  assert.equal(looksLikeComparisonNameMash("Willy Adames"), false);
});

test("mash subqueries are blocked after a mash query", async () => {
  assert.equal(await shouldBlockPlayerSearch("willy adames heliot ramos"), true);
  assert.equal(await shouldBlockPlayerSearch("willy adames"), true);
  assert.equal(await shouldBlockPlayerSearch("heliot ramos"), true);
});

test("raw comparison message is detected", () => {
  assert.equal(
    isCoachRecommendationQuestion("willy adames or heliot ramos to hit a HR?"),
    true,
  );
});

test("wantsSoccerScorerGoalkeeperPicks detects ranked scorer vs keeper ask", () => {
  assert.equal(
    wantsSoccerScorerGoalkeeperPicks(
      "Show me the best scorers facing the worst goalkeepers today",
    ),
    true,
  );
  assert.equal(wantsSoccerScorerGoalkeeperPicks("best HR props for Dodgers"), false);
});
