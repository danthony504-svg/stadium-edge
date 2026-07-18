import test from "node:test";
import assert from "node:assert/strict";
import {
  PROP_LABEL_TO_KEY,
  PROP_MARKET_LABEL_MAP,
  normalizePropLabel,
  propMarketKeyForLabel,
} from "./propMarketConstants.ts";

test("PROP_MARKET_LABEL_MAP is defined at module load", () => {
  assert.ok(PROP_MARKET_LABEL_MAP);
  assert.equal(typeof PROP_MARKET_LABEL_MAP, "object");
  assert.equal(PROP_MARKET_LABEL_MAP.pitcher_strikeouts, "Strikeouts");
});

test("PROP_LABEL_TO_KEY reverses base labels", () => {
  assert.ok(PROP_LABEL_TO_KEY);
  assert.equal(PROP_LABEL_TO_KEY[normalizePropLabel("Strikeouts")], "pitcher_strikeouts");
  assert.equal(PROP_LABEL_TO_KEY[normalizePropLabel("Pts+Reb+Ast")], "player_points_rebounds_assists");
});

test("propMarketKeyForLabel resolves known labels and fails closed on unknown", () => {
  assert.equal(propMarketKeyForLabel("  Strikeouts "), "pitcher_strikeouts");
  assert.equal(propMarketKeyForLabel("Points (Q1)"), null);
});
