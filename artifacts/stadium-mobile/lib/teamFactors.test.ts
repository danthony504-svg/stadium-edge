import { test } from "node:test";
import assert from "node:assert/strict";

import { TIER_META, type FactorTier } from "./propFactors.ts";
import { factorsForTeam } from "./teamFactors.ts";

const SPORTS = ["mlb", "nba", "wnba", "ncaab", "nfl", "ncaaf", "nhl", "soccer", "ufc", ""];

test("every sport returns a non-empty team advisory set with valid tiers", () => {
  for (const sport of SPORTS) {
    const f = factorsForTeam({ sport, teamName: "New York Knicks", oppName: "San Antonio Spurs", isHome: true });
    assert.ok(f.length > 0, sport);
    for (const card of f) {
      assert.ok(card.title && card.body && card.emoji, `${sport} card content`);
      assert.ok(TIER_META[card.tier as FactorTier], `${sport} tier ${card.tier}`);
    }
  }
});

test("personalizes with real team and opponent nicknames", () => {
  const f = factorsForTeam({ sport: "nba", teamName: "New York Knicks", oppName: "San Antonio Spurs", isHome: true });
  const joined = f.map((c) => `${c.title} ${c.body}`).join(" ");
  assert.ok(joined.includes("Knicks"), "should mention team nickname");
  assert.ok(joined.includes("Spurs"), "should mention opponent nickname");
});

test("falls back to neutral nouns when names are absent — never invents", () => {
  const f = factorsForTeam({ sport: "nba", teamName: null, oppName: null, isHome: null });
  const joined = f.map((c) => `${c.title} ${c.body}`).join(" ");
  assert.ok(joined.includes("this team"), "neutral team noun");
  assert.ok(joined.includes("the opponent"), "neutral opponent noun");
  assert.ok(joined.includes("in this game"), "neutral venue phrase");
});

// HONESTY GUARD: advisory copy must never assert a quantitative game fact —
// no posted total, spread value, series score, or scoring claim. Procedural
// guidance and the venue/name personalization are fine.
test("no team advisory body makes a quantitative claim", () => {
  const banned = /\b\d+\s*\+|\bby\s+\d+|\b\d+\s*(?:points?|pts?|percent)\b|\b\d+%|\bdown\s+\d|\bgame\s+\d/i;
  const allCards = SPORTS.flatMap((sport) =>
    factorsForTeam({ sport, teamName: "New York Knicks", oppName: "San Antonio Spurs", isHome: false }),
  );
  for (const card of allCards) {
    assert.ok(!banned.test(card.body), `numeric/series claim in: "${card.body}"`);
  }
});
