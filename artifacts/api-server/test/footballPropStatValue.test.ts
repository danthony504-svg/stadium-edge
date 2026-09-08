import assert from "node:assert/strict";
import test from "node:test";

import { gameValueForMarket } from "../src/lib/propStatValue.ts";

const NONE = new Set<string>();

test("football simulation reads ESPN's unique field names, not colliding labels", () => {
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

