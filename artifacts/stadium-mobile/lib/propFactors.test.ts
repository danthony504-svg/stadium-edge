import { test } from "node:test";
import assert from "node:assert/strict";

import { factorsForProp, TIER_META, type FactorTier, type RealPropSignals } from "./propFactors.ts";

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

// HONESTY GUARD: the GENERIC advisory copy (no `real` signals supplied) must
// never assert a quantitative performance claim (a fabricated number about how a
// player performs). Procedural stat NAMES ("K/9 rate") and "when to check"
// timing ("~1hr before") are allowed. Real cards (next tests) intentionally
// print real numbers and are exempt — they are fed verified feed values.
test("no GENERIC advisory body makes a quantitative performance claim", () => {
  const banned = /\b\d+\s*\+|\bby\s+\d+|\b\d+\s*(?:points?|pts?|percent)\b|\b\d+%/i;
  const allCards = SPORTS.flatMap((sport) => [
    ...factorsForProp({ sport, marketKey: "batter_hits", marketLabel: "Hits" }),
    ...factorsForProp({ sport, marketKey: "pitcher_strikeouts", marketLabel: "Strikeouts" }),
  ]);
  for (const card of allCards) {
    assert.ok(!banned.test(card.body), `numeric claim in: "${card.body}"`);
  }
});

test("absent real signals are byte-identical to the generic set (every sport)", () => {
  for (const sport of SPORTS) {
    const generic = factorsForProp({ sport, marketKey: "batter_hits", marketLabel: "Hits" });
    const explicitNull = factorsForProp({
      sport,
      marketKey: "batter_hits",
      marketLabel: "Hits",
      real: { homeAway: null, recentVsSeason: null, mlb: null },
    });
    assert.deepEqual(explicitNull, generic, sport);
  }
});

test("real home/away + recent-vs-season inject the actual numbers", () => {
  const f = factorsForProp({
    sport: "nba",
    marketKey: "player_points",
    marketLabel: "Points",
    real: {
      homeAway: { homeAvg: 28.4, awayAvg: 22.1, homeN: 5, awayN: 4 },
      recentVsSeason: { recentAvg: 27.5, seasonAvg: 24.0, recentN: 6 },
    },
  });
  const ha = f.find((c) => c.title === "Home / Away Splits");
  const rv = f.find((c) => c.title === "Recent vs Season");
  assert.ok(ha && /28\.4/.test(ha.body) && /22\.1/.test(ha.body), "home/away numbers");
  assert.ok(ha && /points/.test(ha.body), "home/away uses market noun");
  assert.ok(rv && /27\.5/.test(rv.body) && /24\.0/.test(rv.body), "recent vs season numbers");
});

test("real MLB batter signals replace pitcher / platoon / ballpark cards", () => {
  const f = factorsForProp({
    sport: "mlb",
    marketKey: "batter_hits",
    marketLabel: "Hits",
    playerName: "Nico Hoerner",
    real: {
      mlb: {
        pitcher: { name: "Logan Webb", throws: "R", kPer9: 8.4, era: 3.25, hrPer9: 0.9, oppOPS: 0.7, whip: 1.15 },
        platoon: { bats: "R", hand: "R", avg: 0.265, ops: 0.71 },
        ballpark: { venue: "Wrigley Field", hrIndex: 103, dome: false, tempF: 72, windMph: 8, condition: "Clear" },
      },
    },
  });
  const starter = f.find((c) => c.title === "Tonight's Starting Pitcher");
  const platoon = f.find((c) => c.title === "L/R Platoon vs Starter");
  const park = f.find((c) => c.title === "Ballpark & Weather");
  assert.ok(starter && /Logan Webb/.test(starter.body) && /8\.4 K\/9/.test(starter.body), "real starter");
  assert.ok(platoon && /Nico/.test(platoon.body) && /\.265 AVG/.test(platoon.body), "real platoon split");
  assert.ok(park && /Wrigley Field/.test(park.body) && /72°F/.test(park.body), "real ballpark + weather");
});

test("a hittable low-K starter frames the batter's Over (not just K-suppression)", () => {
  // Low strikeout rate but very hittable: high opp OPS + high WHIP. The card must
  // surface those real numbers and read as SUPPORTING the hits/TB Over.
  const hits = factorsForProp({
    sport: "mlb",
    marketKey: "batter_total_bases",
    marketLabel: "Total Bases",
    real: {
      mlb: {
        pitcher: { name: "Soft Tosser", throws: "R", kPer9: 6.2, era: 5.8, hrPer9: 1.1, oppOPS: 0.82, whip: 1.48 },
        platoon: null,
        ballpark: null,
      },
    },
  }).find((c) => c.title === "Tonight's Starting Pitcher");
  assert.ok(hits && /\.820 opp OPS/.test(hits.body) && /1\.48 WHIP/.test(hits.body), "real contact rates shown");
  assert.ok(hits && /supports the hits \/ total-bases Over/i.test(hits.body), "frames the Over");

  // A HR prop on a home-run-prone arm leads with HR/9 and supports the HR Over.
  const hr = factorsForProp({
    sport: "mlb",
    marketKey: "batter_home_runs",
    marketLabel: "Home Runs",
    real: {
      mlb: {
        pitcher: { name: "Gopher Baller", throws: "L", kPer9: 7.0, era: 5.1, hrPer9: 1.7, oppOPS: 0.78, whip: 1.3 },
        platoon: null,
        ballpark: null,
      },
    },
  }).find((c) => c.title === "Tonight's Starting Pitcher");
  assert.ok(hr && /1\.70 HR\/9/.test(hr.body) && /supports the HR Over/i.test(hr.body), "HR-prone arm frames HR Over");
});

test("a dome MLB ballpark reports weather-neutral, never invents wind", () => {
  const f = factorsForProp({
    sport: "mlb",
    marketKey: "batter_hits",
    marketLabel: "Hits",
    real: { mlb: { ballpark: { venue: "Rogers Centre", hrIndex: 103, dome: true, tempF: null, windMph: null, condition: null } } },
  });
  const park = f.find((c) => c.title === "Ballpark & Weather");
  assert.ok(park && /weather neutral/i.test(park.body), "dome neutral");
  assert.ok(park && !/wind/i.test(park.body), "no fabricated wind in a dome");
});

test("MLB cards fall back to generic guidance when a real field is missing", () => {
  const f = factorsForProp({
    sport: "mlb",
    marketKey: "batter_hits",
    marketLabel: "Hits",
    real: { mlb: { pitcher: null, platoon: null, ballpark: null } },
  });
  const starter = f.find((c) => c.title === "Tonight's Starting Pitcher");
  assert.ok(starter && /check the k\/9 rate/i.test(starter.body), "generic starter fallback");
});

// HONESTY GUARD: when the MLB real block is entirely null/partial, the rendered
// MLB cards must not leak any fabricated stat number — they must read as the
// generic guidance set (which carries no performance numbers).
test("no numeric performance value leaks when MLB real fields are null/partial", () => {
  const banned = /\b\d+(?:\.\d+)?\s*(?:k\/9|era|avg|ops|mph|°f|park factor)|\.\d{3}\b/i;
  const cases: RealPropSignals[] = [
    { mlb: null },
    { mlb: { pitcher: null, platoon: null, ballpark: null } },
    // Partial: pitcher present but no throws/tendency, platoon missing its stat.
    { mlb: { pitcher: { name: "TBD", throws: null, kPer9: null, era: null, hrPer9: null, oppOPS: null, whip: null }, platoon: { bats: "R", hand: "R", avg: null, ops: null }, ballpark: null } },
  ];
  for (const real of cases) {
    const f = factorsForProp({ sport: "mlb", marketKey: "batter_hits", marketLabel: "Hits", real });
    for (const c of f) {
      assert.ok(!banned.test(c.body), `leaked stat number in "${c.title}": "${c.body}"`);
    }
  }
});
