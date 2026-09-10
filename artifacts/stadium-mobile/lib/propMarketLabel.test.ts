import test from "node:test";
import assert from "node:assert/strict";
import { propMarketKeyForLabel, propMarketLabel } from "./propMarketLabel.ts";

test("propMarketLabel resolves known market keys", () => {
  assert.equal(propMarketLabel("pitcher_strikeouts"), "Strikeouts");
  assert.equal(propMarketLabel("player_points_rebounds_assists"), "Pts+Reb+Ast");
});

test("propMarketKeyForLabel resolves known labels and fails closed on unknown", () => {
  assert.equal(propMarketKeyForLabel("  Strikeouts "), "pitcher_strikeouts");
  assert.equal(propMarketKeyForLabel("Pts+Reb+Ast"), "player_points_rebounds_assists");
  assert.equal(propMarketKeyForLabel("Points (Q1)"), null);
});
