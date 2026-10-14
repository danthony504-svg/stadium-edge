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
import {
  FOOTBALL_DRIVE_FG_PPD_DIVISOR,
  FOOTBALL_DRIVE_SOFT_SLOPE,
  FOOTBALL_DRIVE_TD_RATE_MAX,
  applyDefenseTiltToOffenseMean,
  defenseOffenseMultiplier,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import { teamMean } from "../src/lib/sportSim/shared.ts";
import { sportSimModelForSport } from "../src/lib/sportSim/registry.ts";

test("ncaaf maps to nfl-drive engine", () => {
  assert.equal(sportSimModelForSport("ncaaf"), "nfl-drive");
  assert.equal(sportSimModelForSport("nfl"), "nfl-drive");
});

test("nfl-drive soft rates: knee still hits former TD cap, then keeps climbing", () => {
  const atTdKnee = NFL_DRIVE_TD_RATE_CAP * NFL_DRIVE_TD_PPD_DIVISOR; // 11.76
  assert.equal(nflDriveScoringRates(atTdKnee).tdRate, NFL_DRIVE_TD_RATE_CAP);
  assert.equal(nflDriveRatesSaturated(atTdKnee), true);
  assert.equal(nflDriveRatesSaturated(10), false);

  // FG knee is independent (ppd = 0.28 * 40 = 11.2).
  const atFgKnee = NFL_DRIVE_FG_RATE_CAP * FOOTBALL_DRIVE_FG_PPD_DIVISOR;
  assert.equal(nflDriveScoringRates(atFgKnee).fgRate, NFL_DRIVE_FG_RATE_CAP);

  // Past the TD knee, rates must still move (soft slope) — no flat hard ceiling.
  const past = atTdKnee + 15;
  const atRates = nflDriveScoringRates(atTdKnee);
  const pastRates = nflDriveScoringRates(past);
  assert.ok(pastRates.tdRate > atRates.tdRate, "TD rate must rise past knee");
  assert.ok(pastRates.tdRate <= FOOTBALL_DRIVE_TD_RATE_MAX);

  const excessLinear = past / NFL_DRIVE_TD_PPD_DIVISOR - NFL_DRIVE_TD_RATE_CAP;
  const expectedTd = Math.min(
    FOOTBALL_DRIVE_TD_RATE_MAX,
    NFL_DRIVE_TD_RATE_CAP + excessLinear * FOOTBALL_DRIVE_SOFT_SLOPE,
  );
  assert.ok(Math.abs(pastRates.tdRate - expectedTd) < 1e-9);
});

test("controlled sensitivity: past-knee ppd shocks move scoring rates", () => {
  const base = teamMean(20, 16.8, 22); // 18.4 — Iowa awayOff (past knee)
  const qbOut = teamMean(14, 16.8, 22); // 15.4 — still past knee
  const plus3 = teamMean(23, 16.8, 22); // 19.9
  assert.equal(nflDriveRatesSaturated(base), true);
  assert.equal(nflDriveRatesSaturated(qbOut), true);
  assert.equal(nflDriveRatesSaturated(plus3), true);
  assert.notDeepEqual(nflDriveScoringRates(base), nflDriveScoringRates(qbOut));
  assert.notDeepEqual(nflDriveScoringRates(base), nflDriveScoringRates(plus3));
  assert.ok(nflDriveScoringRates(plus3).tdRate > nflDriveScoringRates(base).tdRate);
  assert.ok(nflDriveScoringRates(qbOut).tdRate < nflDriveScoringRates(base).tdRate);
});

test("controlled sensitivity: sub-knee shocks still change rates", () => {
  const saturated = 18.4;
  const below = 10.5;
  assert.equal(nflDriveRatesSaturated(saturated), true);
  assert.equal(nflDriveRatesSaturated(below), false);
  assert.ok(nflDriveScoringRates(below).tdRate < NFL_DRIVE_TD_RATE_CAP);
  assert.notDeepEqual(nflDriveScoringRates(saturated), nflDriveScoringRates(below));
});

test("defense yards tilt opposing offense mean within ±8%", () => {
  const soft = {
    rushingYardsAllowedPerGame: 100,
    passingYardsAllowedPerGame: 180,
    rushSampleSize: 5,
    passSampleSize: 5,
  };
  const leaky = {
    rushingYardsAllowedPerGame: 160,
    passingYardsAllowedPerGame: 250,
    rushSampleSize: 5,
    passSampleSize: 5,
  };
  const thin = {
    rushingYardsAllowedPerGame: 200,
    passingYardsAllowedPerGame: 200,
    rushSampleSize: 1,
    passSampleSize: 5,
  };
  assert.equal(defenseOffenseMultiplier(soft, "nfl"), 0.92);
  assert.equal(defenseOffenseMultiplier(leaky, "nfl"), 1.08);
  assert.equal(defenseOffenseMultiplier(thin, "nfl"), 1);
  assert.equal(defenseOffenseMultiplier(null, "ncaaf"), 1);
  assert.ok(Math.abs(applyDefenseTiltToOffenseMean(22, soft, "nfl") - 22 * 0.92) < 1e-9);
});

test("defenseAllowed packs change projected scores under fixed RNG", () => {
  const realRandom = Math.random;
  const runWithSeed = (seed: number, defense: boolean) => {
    let i = seed;
    Math.random = () => {
      i = (i * 1664525 + 1013904223) >>> 0;
      return i / 0x100000000;
    };
    return runNflDriveSim({
      sport: "ncaaf",
      simulations: 3000,
      home: {
        ptsFor: 28,
        ptsAgainst: 16.8,
        recentScores: [21, 24, 31, 28, 27],
        defenseAllowed: defense
          ? {
              rushingYardsAllowedPerGame: 90,
              passingYardsAllowedPerGame: 160,
              rushSampleSize: 5,
              passSampleSize: 5,
            }
          : null,
      },
      away: {
        ptsFor: 20,
        ptsAgainst: 19,
        recentScores: [20, 27, 38, 32, 28],
        defenseAllowed: defense
          ? {
              rushingYardsAllowedPerGame: 180,
              passingYardsAllowedPerGame: 280,
              rushSampleSize: 5,
              passSampleSize: 5,
            }
          : null,
      },
      retainOutcomes: false,
    });
  };
  try {
    const plain = runWithSeed(1, false);
    const tilted = runWithSeed(1, true);
    assert.ok(plain && tilted);
    assert.ok(
      (tilted!.homeProjectedScore ?? 0) !== (plain!.homeProjectedScore ?? 0) ||
        (tilted!.awayProjectedScore ?? 0) !== (plain!.awayProjectedScore ?? 0),
      "defense packs must enter score draws",
    );
  } finally {
    Math.random = realRandom;
  }
});

test("deterministic seeded draws: soft rates keep ML sensitive to form", () => {
  const realRandom = Math.random;
  let i = 0;
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
        { id: "home-ml", kind: "ml", teamSide: "home" },
      ],
      retainOutcomes: false,
    });
    assert.ok(result);
    const awayMl = result!.coverHitRates?.["away-ml"] ?? 0;
    const homeMl = result!.coverHitRates?.["home-ml"] ?? 0;
    const sp = result!.coverHitRates?.["away-sp2"] ?? 0;
    assert.ok(homeMl > awayMl, `expected home ML > away ML, got ${homeMl} vs ${awayMl}`);
    // Soft rates give home a real edge — +2 dog cover sits below coin-flip.
    assert.ok(sp > 0.28 && sp < 0.72, `expected +2 dog in reasonable band, got ${sp}`);
  } finally {
    Math.random = realRandom;
  }
});
