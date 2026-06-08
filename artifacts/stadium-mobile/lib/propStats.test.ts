import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";

const NONE = new Set<string>();

test("player_threes reads the MADE count from an ESPN 'made-attempted' column", () => {
  // ESPN NBA gamelog encodes 3-pointers as "made-attempted", e.g. "2-5".
  assert.equal(gameValueForMarket("player_threes", { "3PT": "2-5" }, NONE), 2);
  assert.equal(gameValueForMarket("player_threes", { "3PT": "0-3" }, NONE), 0);
  assert.equal(gameValueForMarket("player_threes", { "3PT": "10-18" }, NONE), 10);
});

test("player_threes accepts a bare made count and prefers 3PM over 3PT", () => {
  assert.equal(gameValueForMarket("player_threes", { "3PM": "4" }, NONE), 4);
  assert.equal(
    gameValueForMarket("player_threes", { "3PM": "4", "3PT": "2-5" }, NONE),
    4,
  );
});

test("player_threes honest-nulls a missing or malformed column (never guesses)", () => {
  assert.equal(gameValueForMarket("player_threes", {}, NONE), null);
  assert.equal(gameValueForMarket("player_threes", { "3PT": "" }, NONE), null);
  assert.equal(gameValueForMarket("player_threes", { "3PT": "DNP" }, NONE), null);
});

test("player_threes tolerates whitespace but rejects malformed triples", () => {
  assert.equal(gameValueForMarket("player_threes", { "3PT": "2 - 5" }, NONE), 2);
  assert.equal(gameValueForMarket("player_threes", { "3PT": "2-5-1" }, NONE), null);
});

test("player_threes respects the ambiguous set", () => {
  const ambiguous = computeAmbiguous(["3PT", "3PT"]);
  assert.equal(
    gameValueForMarket("player_threes", { "3PT": "2-5" }, ambiguous),
    null,
  );
});

test("plain single-column markets are unaffected", () => {
  assert.equal(gameValueForMarket("player_points", { PTS: "21" }, NONE), 21);
  assert.equal(gameValueForMarket("player_points", {}, NONE), null);
});
