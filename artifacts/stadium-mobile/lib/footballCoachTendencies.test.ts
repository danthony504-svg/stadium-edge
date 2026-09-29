import assert from "node:assert/strict";
import test from "node:test";

import {
  footballCoachSoftTilt,
  lookupFootballCoach,
} from "./footballCoachTendencies.ts";

test("lookupFootballCoach resolves NFL and NCAAF profiles", () => {
  const reid = lookupFootballCoach("nfl", "KC");
  assert.ok(reid);
  assert.equal(reid!.name, "Andy Reid");
  assert.ok(reid!.aggressive >= 2);

  const smart = lookupFootballCoach("ncaaf", "UGA");
  assert.ok(smart);
  assert.match(smart!.name, /Kirby Smart/i);

  assert.equal(lookupFootballCoach("nba", "KC"), null);
  assert.equal(lookupFootballCoach("nfl", "ZZZ"), null);
});

test("footballCoachSoftTilt boosts overs for aggressive coach pairings", () => {
  const overTilt = footballCoachSoftTilt({
    sport: "nfl",
    market: "Total",
    pick: "Over 47.5",
    coaches: {
      home: { name: "Dan Campbell", aggressive: 2, favLean: 1 },
      away: { name: "Sean McVay", aggressive: 2, favLean: 1 },
    },
  });
  const underTilt = footballCoachSoftTilt({
    sport: "nfl",
    market: "Total",
    pick: "Under 47.5",
    coaches: {
      home: { name: "Dan Campbell", aggressive: 2, favLean: 1 },
      away: { name: "Sean McVay", aggressive: 2, favLean: 1 },
    },
  });
  assert.ok(overTilt > 0);
  assert.ok(underTilt < 0);
  assert.ok(Math.abs(overTilt) <= 0.4);
});

test("footballCoachSoftTilt is zero when coaches missing", () => {
  assert.equal(
    footballCoachSoftTilt({
      sport: "nfl",
      market: "Total",
      pick: "Over 45.5",
      coaches: { home: null, away: null },
    }),
    0,
  );
});
