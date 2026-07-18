import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePropSide } from "./propPoolNormalize.ts";

test("normalizePropSide maps market key to label and skips malformed rows", () => {
  const row = normalizePropSide({
    market: "player_points",
    player: "Test Player",
    line: 24.5,
    side: "Over",
    odds: -110,
  });
  assert.ok(row);
  assert.equal(row!.propMarketKey, "player_points");
  assert.equal(row!.propMarketLabel, "Points");
  assert.equal(row!.playerName, "Test Player");
  assert.equal(normalizePropSide({ market: "", player: "X", side: "Over", odds: 100 }), null);
  assert.equal(normalizePropSide({ market: "player_points", player: "X", side: "Over", odds: null }), null);
});
