import assert from "node:assert/strict";
import test from "node:test";
import { shuffleWithSeed, varietyRankKey } from "./varietySeed.ts";

test("shuffleWithSeed permutes differently per build seed", () => {
  const items = Array.from({ length: 12 }, (_, i) => `game-${i}`);
  const a = shuffleWithSeed(items, "build-a");
  const b = shuffleWithSeed(items, "build-b");
  assert.notDeepEqual(a, b);
  assert.equal(new Set(a).size, items.length);
});

test("varietyRankKey is stable for same seed+key", () => {
  assert.equal(varietyRankKey("s1", "k"), varietyRankKey("s1", "k"));
  assert.notEqual(varietyRankKey("s1", "k"), varietyRankKey("s2", "k"));
});
