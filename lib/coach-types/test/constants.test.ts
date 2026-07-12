import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COACH_DEEP_SIM_ITERATIONS,
  COACH_GAME_LINE_EDGE_OVERRIDE_PCT,
  COACH_GATE_IDS,
  COACH_HORIZON_MS,
  COACH_MIN_CONFIDENCE_PCT,
  COACH_PARLAY_SIZES,
  COACH_SPORT_IDS,
} from "../src/index";

describe("coach-types constants", () => {
  it("horizon is 48 hours", () => {
    assert.equal(COACH_HORIZON_MS, 48 * 60 * 60 * 1000);
  });

  it("deep sim requires 10k iterations", () => {
    assert.equal(COACH_DEEP_SIM_ITERATIONS, 10_000);
  });

  it("game line override margin is 3%", () => {
    assert.equal(COACH_GAME_LINE_EDGE_OVERRIDE_PCT, 3);
  });

  it("minimum confidence is 52%", () => {
    assert.equal(COACH_MIN_CONFIDENCE_PCT, 52);
  });

  it("parlay sizes are ordered and include 3 through 15", () => {
    assert.deepEqual(COACH_PARLAY_SIZES, [3, 5, 6, 9, 10, 15]);
  });

  it("all gate ids are unique", () => {
    assert.equal(new Set(COACH_GATE_IDS).size, COACH_GATE_IDS.length);
    assert.equal(COACH_GATE_IDS.length, 10);
  });

  it("supported sport ids include core sports and college", () => {
    for (const sport of ["mlb", "nba", "nfl", "nhl", "wnba", "soccer", "tennis", "mma"]) {
      assert.ok(COACH_SPORT_IDS.includes(sport as (typeof COACH_SPORT_IDS)[number]));
    }
  });
});
