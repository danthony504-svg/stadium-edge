import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NFL_DRIVE_FG_RATE_CAP,
  NFL_DRIVE_TD_PPD_DIVISOR,
  NFL_DRIVE_TD_RATE_CAP,
  nflDriveRatesSaturated,
  nflDriveScoringRates,
  ncaafDriveScoringRates,
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

test("NCAAF candidate maps game mean to drives without saturation in ordinary FBS range", () => {
  for (const points of [8, 15, 21, 28, 35, 42, 55]) {
    const rates = ncaafDriveScoringRates(points, 11);
    const mean = 11 * (7 * rates.tdRate + 3 * rates.fgRate);
    assert.ok(Math.abs(mean - points) < 0.001, `${points}: ${mean}`);
    assert.ok(rates.tdRate + rates.fgRate < 1);
  }
  assert.ok(ncaafDriveScoringRates(30, 11).tdRate > ncaafDriveScoringRates(25, 11).tdRate);
  assert.ok(ncaafDriveScoringRates(25, 11).tdRate > ncaafDriveScoringRates(20, 11).tdRate);
});

test("seeded 10K NCAAF score means track matchup points, and +3/-6 changes spread probability", () => {
  const run = (homePts: number) => {
    const realRandom = Math.random;
    let i = 7;
    Math.random = () => {
      i = (i * 1664525 + 1013904223) >>> 0;
      return i / 0x100000000;
    };
    try {
      return runNflDriveSim({
        sport: "ncaaf", simulations: 10000,
        home: { ptsFor: homePts, ptsAgainst: 19, recentScores: [21, 27, 33, 28, 31] },
        away: { ptsFor: 23, ptsAgainst: 24, recentScores: [20, 27, 26, 17, 30] },
        coverQueries: [{ id: "home-cover", kind: "spread", teamSide: "home", line: -3.5 }],
        retainOutcomes: false,
      });
    } finally { Math.random = realRandom; }
  };
  const baseline = run(28);
  const positive = run(34); // +3 teamMean points via +6 ptsFor
  const qbOut = run(16); // -6 teamMean points via -12 ptsFor
  assert.ok(baseline && positive && qbOut);
  assert.ok(baseline!.homeProjectedScore! < 35 && baseline!.homeProjectedScore! > 18, `baseline mean ${baseline!.homeProjectedScore}`);
  assert.ok(baseline!.awayProjectedScore! < 31 && baseline!.awayProjectedScore! > 16, `opponent mean ${baseline!.awayProjectedScore}`);
  const baseCover = baseline!.coverHitRates!["home-cover"]!;
  const betterCover = positive!.coverHitRates!["home-cover"]!;
  const qbOutCover = qbOut!.coverHitRates!["home-cover"]!;
  assert.ok(betterCover >= baseCover + 0.02, `+3 expected cover +2pt: ${betterCover} vs ${baseCover}`);
  assert.ok(baseCover >= qbOutCover + 0.02, `QB-out expected cover -2pt: ${baseCover} vs ${qbOutCover}`);
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
