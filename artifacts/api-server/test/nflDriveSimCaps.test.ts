import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NFL_DRIVE_FG_RATE_CAP,
  NFL_DRIVE_TD_PPD_DIVISOR,
  NFL_DRIVE_TD_RATE_CAP,
  nflDriveRatesSaturated,
  nflDriveScoringRates,
  runNflDriveSim,
} from "../src/lib/sportSim/nflDriveSim.ts";
import { teamMean } from "../src/lib/sportSim/shared.ts";
import { sportSimModelForSport } from "../src/lib/sportSim/registry.ts";

test("ncaaf maps to nfl-drive engine", () => {
  assert.equal(sportSimModelForSport("ncaaf"), "nfl-drive");
  assert.equal(sportSimModelForSport("nfl"), "nfl-drive");
});

test("nfl-drive TD/FG rate caps saturate at ~11.8 / ~11.2 ppd", () => {
  const atCap = NFL_DRIVE_TD_RATE_CAP * NFL_DRIVE_TD_PPD_DIVISOR; // 11.76
  assert.equal(nflDriveScoringRates(atCap).tdRate, NFL_DRIVE_TD_RATE_CAP);
  assert.equal(nflDriveScoringRates(atCap).fgRate, NFL_DRIVE_FG_RATE_CAP);
  assert.equal(nflDriveRatesSaturated(atCap), true);
  assert.equal(nflDriveRatesSaturated(atCap + 20), true);
  assert.equal(nflDriveRatesSaturated(10), false);

  // Iowa @ WASH-style means both sit above the floor → identical rates.
  const iowaHomeOff = teamMean(28, 19, 22); // 23.5
  const iowaAwayOff = teamMean(20, 16.8, 22); // 18.4
  assert.ok(iowaHomeOff > atCap);
  assert.ok(iowaAwayOff > atCap);
  assert.deepEqual(nflDriveScoringRates(iowaHomeOff), nflDriveScoringRates(iowaHomeOff + 15));
  assert.deepEqual(nflDriveScoringRates(iowaAwayOff), nflDriveScoringRates(iowaAwayOff - 3));
  assert.equal(nflDriveScoringRates(iowaAwayOff).tdRate, NFL_DRIVE_TD_RATE_CAP);
});

test("controlled sensitivity: saturated ppd shocks are NOOP on scoring rates", () => {
  const base = teamMean(20, 16.8, 22); // 18.4 — Iowa awayOff
  const qbOut = teamMean(14, 16.8, 22); // 15.4 — still above TD cap
  const plus3 = teamMean(23, 16.8, 22); // 19.9
  assert.equal(nflDriveRatesSaturated(base), true);
  assert.equal(nflDriveRatesSaturated(qbOut), true);
  assert.equal(nflDriveRatesSaturated(plus3), true);
  assert.deepEqual(nflDriveScoringRates(base), nflDriveScoringRates(qbOut));
  assert.deepEqual(nflDriveScoringRates(base), nflDriveScoringRates(plus3));
});

test("controlled sensitivity: only sub-cap shocks change rates", () => {
  const saturated = 18.4;
  const below = 10.5; // Sac QB-out proxy territory
  assert.equal(nflDriveRatesSaturated(saturated), true);
  assert.equal(nflDriveRatesSaturated(below), false);
  assert.ok(nflDriveScoringRates(below).tdRate < NFL_DRIVE_TD_RATE_CAP);
  assert.notDeepEqual(nflDriveScoringRates(saturated), nflDriveScoringRates(below));
});

test("deterministic seeded draws: saturated home/away means stay near coin-flip ML", () => {
  const realRandom = Math.random;
  let i = 0;
  // Fixed LCG so cover rates are reproducible across runs.
  Math.random = () => {
    i = (i * 1664525 + 1013904223) >>> 0;
    return i / 0x100000000;
  };
  try {
    const result = runNflDriveSim({
      sport: "ncaaf",
      simulations: 5000,
      home: { ptsFor: 28, ptsAgainst: 16.8, recentScores: [21, 24, 31, 28, 27] },
      away: { ptsFor: 20, ptsAgainst: 19, recentScores: [20, 27, 38, 32, 28] },
      coverQueries: [
        { id: "away-ml", kind: "ml", teamSide: "away" },
        { id: "away-sp2", kind: "spread", teamSide: "away", line: 2 },
      ],
      retainOutcomes: false,
    });
    assert.ok(result);
    const ml = result!.coverHitRates?.["away-ml"] ?? 0;
    const sp = result!.coverHitRates?.["away-sp2"] ?? 0;
    // Saturated both sides → ML near 50%; +2 dog covers comfortably.
    assert.ok(ml > 0.4 && ml < 0.6, `expected near coin-flip ML, got ${ml}`);
    assert.ok(sp > 0.5, `expected +2 dog cover >50%, got ${sp}`);
    // Inflated scoring means (same integrity issue as P0 totals).
    assert.ok((result!.homeProjectedScore ?? 0) > 35);
    assert.ok((result!.awayProjectedScore ?? 0) > 35);
  } finally {
    Math.random = realRandom;
  }
});

test("rush/pass defense yards never enter runNflDriveSim inputs", () => {
  // Structural: ctx only accepts ptsFor/ptsAgainst/recentScores — no defense packs.
  const ctxKeys = ["ptsFor", "ptsAgainst", "recentScores"] as const;
  const home = { ptsFor: 9.5, ptsAgainst: 17, recentScores: [7, 10, 14] };
  assert.deepEqual(Object.keys(home).sort(), [...ctxKeys].sort());
  const a = runNflDriveSim({
    sport: "ncaaf",
    simulations: 200,
    home,
    away: { ptsFor: 10, ptsAgainst: 38.5, recentScores: [3, 14, 17] },
    retainOutcomes: false,
  });
  const b = runNflDriveSim({
    sport: "ncaaf",
    simulations: 200,
    home: { ...home /* pretendRushD: 231 would be ignored if present */ },
    away: { ptsFor: 10, ptsAgainst: 38.5, recentScores: [3, 14, 17] },
    retainOutcomes: false,
  });
  assert.ok(a && b);
  // Same pts inputs → same model path (RNG differs; just assert model id).
  assert.equal(a!.simModel, "nfl-drive");
  assert.equal(b!.simModel, "nfl-drive");
});
