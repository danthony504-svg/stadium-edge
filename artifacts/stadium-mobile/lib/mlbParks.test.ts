import assert from "node:assert/strict";
import test from "node:test";

import { mlbBoardDayKeys, mlbParkForAbbr } from "./mlbParks.ts";

test("mlbParkForAbbr returns static HOU dome park", () => {
  const p = mlbParkForAbbr("HOU");
  assert.ok(p);
  assert.equal(p!.dome, true);
  assert.equal(p!.hrIndex, 104);
});

test("mlbBoardDayKeys includes UTC and Eastern calendar days", () => {
  // 1 AM UTC on Sep 30 is still Sep 29 in America/New_York.
  const keys = mlbBoardDayKeys([
    { sport: "mlb", startsAt: "2026-09-30T01:00:00.000Z" },
    { sport: "nfl", startsAt: "2026-09-30T01:00:00.000Z" },
  ]);
  assert.ok(keys.includes("20260930"));
  assert.ok(keys.includes("20260929"));
  assert.equal(keys.includes("20261001"), false);
});

test("mlbBoardDayKeys ignores games without startsAt", () => {
  assert.deepEqual(mlbBoardDayKeys([{ sport: "mlb" }]), []);
});
