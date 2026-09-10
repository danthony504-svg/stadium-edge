import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COACH_HORIZON_MS } from "@workspace/coach-types";

import {
  filterByCoachHorizon,
  filterPregameGames,
  isPregameStatus,
  isWithinCoachHorizon,
} from "../src/horizon";

const NOW = Date.parse("2026-07-12T20:00:00.000Z");

describe("coach-data horizon", () => {
  it("accepts games within 48h", () => {
    const startsAt = new Date(NOW + 6 * 60 * 60 * 1000).toISOString();
    assert.equal(isWithinCoachHorizon(startsAt, NOW), true);
  });

  it("rejects games outside 48h", () => {
    const startsAt = new Date(NOW + COACH_HORIZON_MS + 60_000).toISOString();
    assert.equal(isWithinCoachHorizon(startsAt, NOW), false);
  });

  it("rejects games without kickoff", () => {
    assert.equal(isWithinCoachHorizon(null, NOW), false);
  });

  it("rejects in-progress and final games", () => {
    assert.equal(isPregameStatus("in_progress"), false);
    assert.equal(isPregameStatus("final"), false);
    assert.equal(isPregameStatus("scheduled"), true);
  });

  it("filterPregameGames drops stale and live games", () => {
    const result = filterPregameGames(
      [
        {
          gameId: "g1",
          startsAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
          status: "scheduled",
        },
        {
          gameId: "g2",
          startsAt: new Date(NOW + 3 * 60 * 60 * 1000).toISOString(),
          status: "final",
        },
        {
          gameId: "g3",
          startsAt: new Date(NOW + 72 * 60 * 60 * 1000).toISOString(),
          status: "scheduled",
        },
      ],
      NOW,
    );
    assert.equal(result.kept.length, 1);
    assert.equal(result.kept[0]?.gameId, "g1");
    assert.equal(result.dropped, 2);
  });

  it("filterByCoachHorizon keeps only in-window lines", () => {
    const result = filterByCoachHorizon(
      [
        { startsAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() },
        { startsAt: new Date(NOW + 60 * 60 * 1000).toISOString() },
      ],
      NOW,
    );
    assert.equal(result.kept.length, 2);
  });
});
