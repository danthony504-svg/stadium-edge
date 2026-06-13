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
        pitcher: { name: "Logan Webb", throws: "R", kPer9: 8.4, era: 3.25, hrPer9: 0.9, oppOPS: 0.7, whip: 1.15, flyBallPct: null, barrelPctAllowed: null, hardHitPctAllowed: null, battedBallEvents: null },
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
        pitcher: { name: "Soft Tosser", throws: "R", kPer9: 6.2, era: 5.8, hrPer9: 1.1, oppOPS: 0.82, whip: 1.48, flyBallPct: 0.42, barrelPctAllowed: 9.5, hardHitPctAllowed: 43.0, battedBallEvents: 120 },
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
        pitcher: { name: "Gopher Baller", throws: "L", kPer9: 7.0, era: 5.1, hrPer9: 1.7, oppOPS: 0.78, whip: 1.3, flyBallPct: null, barrelPctAllowed: null, hardHitPctAllowed: null, battedBallEvents: null },
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
    { mlb: { pitcher: { name: "TBD", throws: null, kPer9: null, era: null, hrPer9: null, oppOPS: null, whip: null, flyBallPct: null, barrelPctAllowed: null, hardHitPctAllowed: null, battedBallEvents: null }, platoon: { bats: "R", hand: "R", avg: null, ops: null }, ballpark: null } },
  ];
  for (const real of cases) {
    const f = factorsForProp({ sport: "mlb", marketKey: "batter_hits", marketLabel: "Hits", real });
    for (const c of f) {
      assert.ok(!banned.test(c.body), `leaked stat number in "${c.title}": "${c.body}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// Opponent team-defense card (REAL, two-sided). Uses ONLY the opposing team's
// own team-wide defensive production — never a positional "allows X to this
// player" split. Each sport renders real numbers when supplied and falls back
// to its evergreen generic matchup card when the feed carried nothing.
// ---------------------------------------------------------------------------

const EMPTY_OD: NonNullable<RealPropSignals["oppDefense"]> = {
  team: null,
  pointsAgainst: null,
  blocks: null,
  steals: null,
  defRebounds: null,
  sacks: null,
  interceptions: null,
  passesDefended: null,
  stuffs: null,
  savePct: null,
  goalsAgainstAvg: null,
  cleanSheets: null,
};

test("NBA scoring prop surfaces real opponent rim protection (caps) vs leaky (Over)", () => {
  const rim = factorsForProp({
    sport: "nba",
    marketKey: "player_points",
    marketLabel: "Points",
    oppName: "Memphis Grizzlies",
    real: { oppDefense: { ...EMPTY_OD, team: "Memphis Grizzlies", blocks: 6.2, pointsAgainst: 110 } },
  });
  const card = rim.find((c) => /6\.2 blocks\/g/.test(c.body));
  assert.ok(card, "shows real blocks/g");
  assert.ok(/rim protection/i.test(card!.body), "caps interior scoring lean");

  const leaky = factorsForProp({
    sport: "nba",
    marketKey: "player_points",
    marketLabel: "Points",
    oppName: "Washington Wizards",
    real: { oppDefense: { ...EMPTY_OD, team: "Washington Wizards", blocks: 3.8, pointsAgainst: 122 } },
  });
  assert.ok(leaky.some((c) => /leaky defense — supports the Over/i.test(c.body)), "leaky → Over");
});

test("NBA rebounds prop is two-sided on real defensive rebounds", () => {
  const cleans = factorsForProp({
    sport: "nba",
    marketKey: "player_rebounds",
    marketLabel: "Rebounds",
    oppName: "Cleveland Cavaliers",
    real: { oppDefense: { ...EMPTY_OD, team: "Cleveland Cavaliers", defRebounds: 36.5 } },
  });
  assert.ok(cleans.some((c) => /36\.5 def reb\/g/.test(c.body) && /fewer boards/i.test(c.body)), "cleans glass");

  const gives = factorsForProp({
    sport: "nba",
    marketKey: "player_rebounds",
    marketLabel: "Rebounds",
    oppName: "Atlanta Hawks",
    real: { oppDefense: { ...EMPTY_OD, team: "Atlanta Hawks", defRebounds: 30.2 } },
  });
  assert.ok(gives.some((c) => /more boards available/i.test(c.body)), "gives up glass");
});

test("NFL passing prop shows real pass rush + INTs, two-sided on the points-allowed rate", () => {
  // Stingy unit (low pts/g) → caps, mentions the pressure descriptively.
  const stingy = factorsForProp({
    sport: "nfl",
    marketKey: "player_pass_yds",
    marketLabel: "Passing Yards",
    oppName: "Pittsburgh Steelers",
    real: { oppDefense: { ...EMPTY_OD, team: "Pittsburgh Steelers", pointsAgainst: 16.5, sacks: 42, interceptions: 15 } },
  });
  const card = stingy.find((c) => /42 sacks/.test(c.body) && /15 INT/.test(c.body));
  assert.ok(card, "shows season sacks + INT");
  assert.ok(/this season/i.test(card!.body), "labels counting stats as season totals");
  assert.ok(/caps passing Overs|raises INT risk/i.test(card!.body), "stingy → caps lean");

  // Leaky unit (high pts/g) → supports the Over EVEN with sacks/INT present.
  // (Season totals must NOT force a one-sided "caps" lean.)
  const leaky = factorsForProp({
    sport: "nfl",
    marketKey: "player_pass_yds",
    marketLabel: "Passing Yards",
    oppName: "Carolina Panthers",
    real: { oppDefense: { ...EMPTY_OD, team: "Carolina Panthers", pointsAgainst: 28, sacks: 40, interceptions: 12 } },
  });
  assert.ok(leaky.some((c) => /leaky defense — supports the Over/i.test(c.body)), "leaky → Over despite totals");
  assert.ok(!leaky.some((c) => /caps passing Overs/i.test(c.body)), "no one-sided caps from raw totals");

  // Neutral pts/g with totals present → totals shown but NO directional lean.
  const neutral = factorsForProp({
    sport: "nfl",
    marketKey: "player_pass_yds",
    marketLabel: "Passing Yards",
    oppName: "Test",
    real: { oppDefense: { ...EMPTY_OD, pointsAgainst: 22, sacks: 38, interceptions: 11 } },
  });
  const ncard = neutral.find((c) => /38 sacks/.test(c.body));
  assert.ok(ncard && !/supports the Over|caps/i.test(ncard.body), "neutral rate → no lean from totals");
});

test("NHL prop shows real save% / GAA and the goalie lean (normalizes SV% scale)", () => {
  const hot = factorsForProp({
    sport: "nhl",
    marketKey: "player_shots_on_goal",
    marketLabel: "Shots on Goal",
    oppName: "Winnipeg Jets",
    real: { oppDefense: { ...EMPTY_OD, team: "Winnipeg Jets", savePct: 0.922, goalsAgainstAvg: 2.4 } },
  });
  assert.ok(hot.some((c) => /\.922 SV%/.test(c.body) && /2\.40 GAA/.test(c.body)), "shows SV% + GAA");
  assert.ok(hot.some((c) => /hot goalie/i.test(c.body)), "hot goalie caps");

  const pct = factorsForProp({
    sport: "nhl",
    marketKey: "player_shots_on_goal",
    marketLabel: "Shots on Goal",
    oppName: "Test",
    real: { oppDefense: { ...EMPTY_OD, savePct: 92.2 } },
  });
  assert.ok(pct.some((c) => /\.922 SV%/.test(c.body)), "normalizes percentage-scale SV%");
});

test("soccer prop shows real goals allowed + clean sheets, two-sided back line", () => {
  const stingy = factorsForProp({
    sport: "soccer",
    marketKey: "player_shots",
    marketLabel: "Shots",
    oppName: "Atletico Madrid",
    real: { oppDefense: { ...EMPTY_OD, team: "Atletico Madrid", pointsAgainst: 0.8, cleanSheets: 12 } },
  });
  assert.ok(stingy.some((c) => /0\.80 goals allowed\/g/.test(c.body) && /12 clean sheets/.test(c.body)), "shows rate + clean sheets");
  assert.ok(stingy.some((c) => /stingy back line/i.test(c.body)), "stingy caps");
});

test("opponent-defense card falls back to generic when no real number landed", () => {
  // All-null oppDefense → realOppDefenseCard returns null → generic kept.
  const f = factorsForProp({
    sport: "nba",
    marketKey: "player_points",
    marketLabel: "Points",
    oppName: "New York Knicks",
    real: { oppDefense: { ...EMPTY_OD } },
  });
  assert.ok(f.some((c) => /scoring ceiling/i.test(c.body)), "kept generic defense card");
  // And no fabricated number leaks.
  assert.ok(!f.some((c) => /\d+\.\d+ (?:blocks|steals|def reb|pts allowed)\/g/.test(c.body)), "no leaked numbers");
});

// HONESTY GUARD: the opponent-defense card must NEVER imply positional /
// per-player defense — the language must stay team-wide.
test("opponent-defense card never claims positional/per-player defense", () => {
  const banned = /allows? (?:him|her|this player|\d)|to (?:point guards|shooting guards|wide receivers|the position)/i;
  const f = factorsForProp({
    sport: "nba",
    marketKey: "player_assists",
    marketLabel: "Assists",
    oppName: "Boston Celtics",
    real: { oppDefense: { ...EMPTY_OD, team: "Boston Celtics", steals: 9.1, pointsAgainst: 106 } },
  });
  for (const c of f) assert.ok(!banned.test(c.body), `positional claim in "${c.title}": "${c.body}"`);
  assert.ok(f.some((c) => /9\.1 steals\/g/.test(c.body) && /ball-hawking/i.test(c.body)), "real steals + lean");
});
