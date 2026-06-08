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

test("NBA returns market-specific factor sets", () => {
  const ast = factorsForProp({ sport: "nba", marketKey: "player_assists", marketLabel: "Assists" });
  const reb = factorsForProp({ sport: "nba", marketKey: "player_rebounds", marketLabel: "Rebounds" });
  const threes = factorsForProp({ sport: "nba", marketKey: "player_threes", marketLabel: "Made Threes" });
  assert.ok(ast.some((c) => /assist/i.test(c.body)), "assists copy");
  assert.ok(reb.some((c) => /rebound|board/i.test(c.body)), "rebounds copy");
  assert.ok(threes.some((c) => /three|perimeter/i.test(c.body)), "threes copy");
  assert.notDeepEqual(ast, reb);
  assert.notDeepEqual(ast, threes);
});

test("NBA personalizes with real player + team names, falls back when absent", () => {
  const named = factorsForProp({
    sport: "nba",
    marketKey: "player_assists",
    marketLabel: "Assists",
    playerName: "Victor Wembanyama",
    teamName: "San Antonio Spurs",
    oppName: "New York Knicks",
  });
  assert.ok(named.some((c) => c.title.includes("Knicks")), "names opponent in title");
  assert.ok(named.some((c) => c.title.includes("Spurs")), "names own team in title");
  assert.ok(named.some((c) => c.body.includes("Victor")), "uses player first name");

  const anon = factorsForProp({ sport: "nba", marketKey: "player_assists", marketLabel: "Assists" });
  assert.ok(!anon.some((c) => /undefined|null/i.test(c.title + c.body)), "no leaked placeholders");
  assert.ok(anon.some((c) => c.body.includes("the player")), "neutral player fallback");
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
