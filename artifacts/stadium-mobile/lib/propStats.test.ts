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

test("football props use unambiguous ESPN machine fields", () => {
  const stats = {
    passingYards: "278",
    passingAttempts: "35",
    completions: "24",
    passingTouchdowns: "2",
    interceptions: "1",
    longPassing: "47",
    rushingYards: "18",
    rushingAttempts: "4",
    longRushing: "11",
    receivingYards: "96",
    receptions: "7",
    longReception: "31",
  };
  const expected: Array<[string, number]> = [
    ["player_pass_yds", 278],
    ["player_pass_attempts", 35],
    ["player_pass_completions", 24],
    ["player_pass_tds", 2],
    ["player_pass_interceptions", 1],
    ["player_pass_longest_completion", 47],
    ["player_rush_yds", 18],
    ["player_rush_attempts", 4],
    ["player_rush_longest", 11],
    ["player_reception_yds", 96],
    ["player_receptions", 7],
    ["player_reception_longest", 31],
  ];
  for (const [market, value] of expected) {
    assert.equal(gameValueForMarket(market, stats, NONE), value, market);
  }
});

test("football props fail closed when the unique ESPN field is unavailable", () => {
  const ambiguousYards = computeAmbiguous(["YDS", "YDS"]);
  assert.equal(gameValueForMarket("player_pass_yds", { YDS: "278" }, ambiguousYards), null);
  assert.equal(gameValueForMarket("player_rush_yds", { YDS: "18" }, ambiguousYards), null);
});
