import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyMarketWeighting,
  classifyBuckets,
  familyKeyForPick,
  marketConfidenceDelta,
  perfMapFromByFamily,
  performanceBiasPoints,
  staticBiasPoints,
  type MarketPerf,
  type WeightablePick,
} from "./marketWeighting.ts";
import type { CombinedPickScore } from "./pickScore.ts";

// A minimal grounded score (confidencePct present) so applyMarketWeighting acts.
const score = (confidencePct: number | null): CombinedPickScore =>
  ({
    scores: { matchup: null, trend: null, lineValue: null, injury: null, lineShopping: null },
    composite: confidencePct == null ? null : 5,
    grade: "C",
    confidencePct,
    edgePct: null,
  }) as CombinedPickScore;

// ---- familyKeyForPick --------------------------------------------------------

test("familyKeyForPick maps game markets to grader families", () => {
  assert.equal(familyKeyForPick({ market: "Spread" }), "spread");
  assert.equal(familyKeyForPick({ market: "Run Line" }), "spread");
  assert.equal(familyKeyForPick({ market: "Total" }), "total");
  assert.equal(familyKeyForPick({ market: "Moneyline" }), "moneyline");
});

test("familyKeyForPick maps prop market keys to grader stat families", () => {
  assert.equal(familyKeyForPick({ isProp: true, propMarketKey: "player_rebounds" }), "rebounds");
  assert.equal(familyKeyForPick({ isProp: true, propMarketKey: "player_points" }), "points");
  assert.equal(familyKeyForPick({ isProp: true, propMarketKey: "batter_total_bases" }), "total bases");
  assert.equal(familyKeyForPick({ isProp: true, propMarketKey: "batter_home_runs" }), "home runs");
  assert.equal(familyKeyForPick({ isProp: true, propMarketKey: "pitcher_strikeouts" }), "strikeouts");
});

// ---- classifyBuckets + static bias ------------------------------------------

test("static bias boosts the prioritized markets", () => {
  assert.equal(staticBiasPoints({ isProp: true, propMarketKey: "player_rebounds" }), 6);
  assert.equal(staticBiasPoints({ market: "Spread" }), 3);
  assert.equal(staticBiasPoints({ isProp: true, propMarketKey: "player_blocks" }), 4);
  assert.equal(staticBiasPoints({ isProp: true, propMarketKey: "player_steals" }), 4);
});

test("static bias reduces the de-prioritized markets", () => {
  assert.equal(staticBiasPoints({ isProp: true, propMarketKey: "player_points" }), -6);
  assert.equal(staticBiasPoints({ isProp: true, propMarketKey: "player_assists" }), -5);
  assert.equal(staticBiasPoints({ market: "Total" }), -4);
});

test("WNBA prop and MLB prop sport buckets stack with the market bucket", () => {
  // WNBA rebounds prop: rebounds (+6) + wnba_props (+5) = +11 -> clamped to +10.
  const wnbaReb: WeightablePick = { isProp: true, sport: "wnba", propMarketKey: "player_rebounds" };
  assert.deepEqual(classifyBuckets(wnbaReb).sort(), ["rebounds", "wnba_props"]);
  assert.equal(staticBiasPoints(wnbaReb), 10);

  // MLB points-style prop would be hits etc.; an MLB strikeouts prop is just the
  // mlb_props reduction (no other bucket): -3.
  const mlbK: WeightablePick = { isProp: true, sport: "mlb", propMarketKey: "pitcher_strikeouts" };
  assert.deepEqual(classifyBuckets(mlbK), ["mlb_props"]);
  assert.equal(staticBiasPoints(mlbK), -3);
});

test("combo prop markets do not match the single-market buckets", () => {
  const combo: WeightablePick = { isProp: true, propMarketKey: "player_points_rebounds_assists" };
  assert.deepEqual(classifyBuckets(combo), []);
  assert.equal(staticBiasPoints(combo), 0);
});

// ---- performance bias (real data only) --------------------------------------

const perfMap = (entries: Array<[string, number, number]>): Map<string, MarketPerf> => {
  // [family, wins, losses]
  const byFamily = entries.map(([key, wins, losses]) => ({
    key,
    tally: { wins, losses, pushes: 0 },
  }));
  return perfMapFromByFamily(byFamily);
};

test("performance bias requires a sufficient real sample", () => {
  // 19 decided -> below MIN_PERF_SAMPLE -> no bias even though hot.
  const thin = perfMap([["rebounds", 19, 0]]);
  assert.equal(performanceBiasPoints({ isProp: true, propMarketKey: "player_rebounds" }, thin), 0);
});

test("cold market (<40% over 20+) downgrades, hot market (>60%) upgrades", () => {
  const cold = perfMap([["points", 6, 18]]); // 25% over 24
  const hot = perfMap([["rebounds", 16, 8]]); // 66.7% over 24
  const mid = perfMap([["assists", 12, 12]]); // 50% over 24
  assert.equal(performanceBiasPoints({ isProp: true, propMarketKey: "player_points" }, cold), -8);
  assert.equal(performanceBiasPoints({ isProp: true, propMarketKey: "player_rebounds" }, hot), 8);
  assert.equal(performanceBiasPoints({ isProp: true, propMarketKey: "player_assists" }, mid), 0);
});

test("performance bias is zero when no perf map is supplied", () => {
  assert.equal(performanceBiasPoints({ isProp: true, propMarketKey: "player_points" }, undefined), 0);
});

// ---- total delta + apply -----------------------------------------------------

test("total delta combines static + performance and clamps", () => {
  // rebounds static +6, hot rebounds perf +8 = +14 (within ±15).
  const hot = perfMap([["rebounds", 18, 6]]); // 75%
  assert.equal(
    marketConfidenceDelta({ isProp: true, propMarketKey: "player_rebounds" }, hot),
    14,
  );
  // WNBA rebounds static clamps to +10, plus hot +8 = +18 -> clamped to +15.
  const wnbaHot = perfMap([["rebounds", 18, 6]]);
  assert.equal(
    marketConfidenceDelta(
      { isProp: true, sport: "wnba", propMarketKey: "player_rebounds" },
      wnbaHot,
    ),
    15,
  );
});

test("applyMarketWeighting nudges a grounded confidence, clamped to 5-95", () => {
  const reb = applyMarketWeighting(score(70), { isProp: true, propMarketKey: "player_rebounds" });
  assert.equal(reb?.confidencePct, 76); // +6 static

  const pts = applyMarketWeighting(score(70), { isProp: true, propMarketKey: "player_points" });
  assert.equal(pts?.confidencePct, 64); // -6 static

  // Clamp ceiling.
  const high = applyMarketWeighting(score(92), {
    isProp: true,
    sport: "wnba",
    propMarketKey: "player_rebounds",
  });
  assert.equal(high?.confidencePct, 95);
});

test("applyMarketWeighting NEVER fabricates a confidence", () => {
  // Null confidence (ungroundable leg) stays null.
  const nullScore = applyMarketWeighting(score(null), {
    isProp: true,
    propMarketKey: "player_rebounds",
  });
  assert.equal(nullScore?.confidencePct, null);
  // Null combined stays null.
  assert.equal(applyMarketWeighting(null, { isProp: true, propMarketKey: "player_rebounds" }), null);
});

test("a neutral market with no perf data is left unchanged", () => {
  const ml = applyMarketWeighting(score(55), { market: "Moneyline" });
  assert.equal(ml?.confidencePct, 55);
});

test("perfMapFromByFamily computes decided + hit rate, null when no decisions", () => {
  const map = perfMapFromByFamily([
    { key: "Rebounds", tally: { wins: 6, losses: 4, pushes: 2 } },
    { key: "points", tally: { wins: 0, losses: 0, pushes: 3 } },
  ]);
  assert.deepEqual(map.get("rebounds"), { decided: 10, hitRatePct: 60 });
  assert.deepEqual(map.get("points"), { decided: 0, hitRatePct: null });
});
