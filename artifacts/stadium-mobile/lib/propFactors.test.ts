import { test } from "node:test";
import assert from "node:assert/strict";

import { factorsForProp, TIER_META, type FactorTier } from "./propFactors.ts";

const SPORTS = ["mlb", "nba", "wnba", "ncaab", "nfl", "ncaaf", "nhl", "soccer", "ufc", ""];

test("every sport returns a non-empty advisory set with valid tiers", () => {
  for (const sport of SPORTS) {
    const f = factorsForProp({ sport, marketKey: "x", marketLabel: "Points" });
    assert.ok(f.length > 0, sport);
    for (const card of f) {
      assert.ok(card.title && card.body && card.emoji, `${sport} card content`);
      assert.ok(TIER_META[card.tier as FactorTier], `${sport} tier ${card.tier}`);
    }
  }
});

test("MLB splits batter vs pitcher sets by market", () => {
  const batter = factorsForProp({ sport: "mlb", marketKey: "batter_hits", marketLabel: "Hits" });
  const pitcher = factorsForProp({
    sport: "mlb",
    marketKey: "pitcher_strikeouts",
    marketLabel: "Strikeouts",
  });
  assert.ok(batter.some((c) => /starting pitcher/i.test(c.title)));
  assert.ok(pitcher.some((c) => /lineup k-rate|pitch count/i.test(c.title)));
  assert.notDeepEqual(batter, pitcher);
});

// HONESTY GUARD: advisory copy must never assert a quantitative performance
// claim (a fabricated number about how a player performs). Procedural stat
// NAMES ("K/9 rate") and "when to check" timing ("~1hr before") are allowed.
test("no advisory body makes a quantitative performance claim", () => {
  const banned = /\b\d+\s*\+|\bby\s+\d+|\b\d+\s*(?:points?|pts?|percent)\b|\b\d+%/i;
  const allCards = SPORTS.flatMap((sport) => [
    ...factorsForProp({ sport, marketKey: "batter_hits", marketLabel: "Hits" }),
    ...factorsForProp({ sport, marketKey: "pitcher_strikeouts", marketLabel: "Strikeouts" }),
  ]);
  for (const card of allCards) {
    assert.ok(!banned.test(card.body), `numeric claim in: "${card.body}"`);
  }
});
