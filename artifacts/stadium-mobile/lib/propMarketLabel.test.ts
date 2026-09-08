import assert from "node:assert/strict";
import { test } from "node:test";

import { PROP_MARKET_LABEL_MAP, propMarketKeyForLabel, propMarketLabel } from "./propMarketLabel.ts";

test("PROP_MARKET_LABEL_MAP backs propMarketLabel and reverse lookup", () => {
  assert.ok(Object.keys(PROP_MARKET_LABEL_MAP).length > 10);
  assert.equal(propMarketLabel("pitcher_strikeouts"), "Strikeouts");
  assert.equal(propMarketKeyForLabel("Strikeouts"), "pitcher_strikeouts");
  assert.equal(propMarketKeyForLabel("strikeouts"), "pitcher_strikeouts");
  assert.equal(propMarketKeyForLabel("Points (Q1)"), null);
});
