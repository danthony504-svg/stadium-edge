import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePositionMarketModel,
  inferPropPosition,
  POSITION_MARKET_MODELS,
  resolvePositionMarketModel,
} from "./positionMarketModels.ts";
import {
  createPositionMarketManifest,
  recordPositionMarketStage,
} from "./positionMarketManifest.ts";

test("football profiles select different predictive features by position and market", () => {
  const qbYards = resolvePositionMarketModel("nfl", "QB", "player_pass_yds");
  const qbRush = resolvePositionMarketModel("nfl", "QB", "player_rush_yds");
  const rbRush = resolvePositionMarketModel("nfl", "RB", "player_rush_yds");
  const wrReceptions = resolvePositionMarketModel("nfl", "WR", "player_receptions");
  assert.ok(qbYards?.features.some((feature) => feature.key === "cpoe"));
  assert.ok(qbRush?.features.some((feature) => feature.key === "scramble_rate"));
  assert.ok(rbRush?.features.some((feature) => feature.key === "opportunity_share"));
  assert.ok(wrReceptions?.features.some((feature) => feature.key === "targets_per_route_run"));
  assert.notDeepEqual(qbYards?.features, qbRush?.features);
});

test("NCAA football profiles include adjustment and uncertainty features", () => {
  const model = resolvePositionMarketModel("ncaaf", "QB", "player_pass_yds");
  assert.ok(model?.features.some((feature) => feature.key === "strength_of_schedule"));
  assert.ok(model?.features.some((feature) => feature.key === "garbage_time_filtered"));
  assert.ok(model?.features.some((feature) => feature.key === "transfer_new_starter_uncertainty"));
});

test("supported non-football sports resolve position-market profiles", () => {
  assert.equal(inferPropPosition("mlb", "pitcher_strikeouts"), "P");
  assert.ok(resolvePositionMarketModel("mlb", "P", "pitcher_strikeouts"));
  assert.ok(resolvePositionMarketModel("nba", "PG", "player_points"));
  assert.ok(resolvePositionMarketModel("wnba", "C", "player_rebounds"));
  assert.ok(resolvePositionMarketModel("nhl", "SKATER", "player_goals"));
  assert.ok(resolvePositionMarketModel("soccer", "OUTFIELD", "player_shots"));
  assert.ok(resolvePositionMarketModel("tennis", "PLAYER", "moneyline"));
  assert.ok(resolvePositionMarketModel("ufc", "FIGHTER", "moneyline"));
});

test("every registered position-market model has core pricing and simulation inputs", () => {
  for (const model of POSITION_MARKET_MODELS) {
    const core = model.features.filter((feature) => feature.tier === "core").map((feature) => feature.key);
    assert.ok(core.includes("posted_line"), model.position);
    assert.ok(core.includes("posted_odds"), model.position);
    assert.ok(core.includes("simulation"), model.position);
  }
});

test("missing supporting features reduce completeness without eliminating a valid candidate", () => {
  const evaluation = evaluatePositionMarketModel({
    sport: "nfl",
    position: "QB",
    market: "player_pass_yds",
    side: "Over",
    line: 245.5,
    odds: -110,
    simHit: 0.58,
    featureScores: { recent_form: 7, opponent: 7 },
  });
  assert.ok(evaluation);
  assert.deepEqual(evaluation?.missingCore, []);
  assert.ok((evaluation?.missingSupporting.length ?? 0) > 0);
  assert.ok((evaluation?.dataCompletenessPct ?? 0) < 100);
  assert.notEqual(evaluation?.gradeScore, null);
  assert.notEqual(evaluation?.confidencePct, null);
});

test("position-market manifest retains every funnel stage and rejection reason", () => {
  const manifest = createPositionMarketManifest();
  recordPositionMarketStage(manifest, "rawMarkets");
  recordPositionMarketStage(manifest, "eligiblePlayers");
  recordPositionMarketStage(manifest, "projectedMarkets");
  recordPositionMarketStage(manifest, "evQualified", { rejectedReason: "negative_ev", key: "QB|pass_yds" });
  recordPositionMarketStage(manifest, "confidenceQualified", { rejectedReason: "low_confidence", key: "RB|rush_yds" });
  recordPositionMarketStage(manifest, "correlationQualified");
  recordPositionMarketStage(manifest, "finalPicks");
  assert.equal(manifest.counts.rawMarkets, 1);
  assert.equal(manifest.counts.finalPicks, 1);
  assert.equal(manifest.rejectionCounts.negative_ev, 1);
  assert.equal(manifest.rejectionCounts.low_confidence, 1);
});
