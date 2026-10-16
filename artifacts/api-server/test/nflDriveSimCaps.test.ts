import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nflDriveRatesSaturated,
  nflDriveScoringRates,
  runNflDriveSim,
} from "../src/lib/sportSim/nflDriveSim.ts";
import {
  FOOTBALL_DRIVE_ENGINE_VERSION,
  FOOTBALL_DRIVE_SCORE_RATE_CAP,
  applyDefenseTiltToOffenseMean,
  defenseOffenseMultiplier,
  footballDriveRateInput,
  footballExpectedDrives,
  footballExpectedPointsPerDrive,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import { teamMean } from "../src/lib/sportSim/shared.ts";
import { sportSimModelForSport } from "../src/lib/sportSim/registry.ts";

test("ncaaf maps to nfl-drive engine", () => {
  assert.equal(sportSimModelForSport("ncaaf"), "nfl-drive");
  assert.equal(sportSimModelForSport("nfl"), "nfl-drive");
});

test("nfl-drive rates: points per drive match expected points below the joint ceiling", () => {
  assert.equal(FOOTBALL_DRIVE_ENGINE_VERSION, "ppg-per-drive-v1");
  for (const ppd of [1.2, 2.0, 3.2]) {
    const rates = nflDriveScoringRates(ppd);
    assert.ok(rates.tdRate > 0 && rates.fgRate > 0);
    assert.ok(rates.tdRate + rates.fgRate < FOOTBALL_DRIVE_SCORE_RATE_CAP);
    assert.equal(nflDriveRatesSaturated(ppd), false);
    assert.ok(Math.abs(footballExpectedPointsPerDrive(ppd) - ppd) < 1e-9);
  }
  const low = nflDriveScoringRates(1.2);
  const mid = nflDriveScoringRates(2.0);
  const high = nflDriveScoringRates(3.2);
  assert.ok(low.tdRate < mid.tdRate && mid.tdRate < high.tdRate);
  assert.ok(low.fgRate < mid.fgRate && mid.fgRate < high.fgRate);

  const ceiling = nflDriveScoringRates(12);
  assert.equal(nflDriveRatesSaturated(12), true);
  assert.ok(
    Math.abs(ceiling.tdRate + ceiling.fgRate - FOOTBALL_DRIVE_SCORE_RATE_CAP) < 1e-9,
  );
  assert.ok(footballExpectedPointsPerDrive(12) < 12);
});

test("controlled sensitivity: points-per-game shocks change points per drive", () => {
  const drives = footballExpectedDrives(22, 22, "nfl");
  const basePpg = teamMean(22, 22, 22);
  const qbOutPpg = teamMean(16, 22, 22);
  const plus3Ppg = teamMean(25, 22, 22);
  const base = footballDriveRateInput(basePpg, drives, "nfl");
  const qbOut = footballDriveRateInput(qbOutPpg, drives, "nfl");
  const plus3 = footballDriveRateInput(plus3Ppg, drives, "nfl");
  assert.ok(base < 4, `realistic PPD stays per-drive, got ${base}`);
  assert.equal(nflDriveRatesSaturated(base), false);
  assert.equal(nflDriveRatesSaturated(qbOut), false);
  assert.equal(nflDriveRatesSaturated(plus3), false);
  assert.ok(nflDriveScoringRates(plus3).tdRate > nflDriveScoringRates(base).tdRate);
  assert.ok(nflDriveScoringRates(qbOut).tdRate < nflDriveScoringRates(base).tdRate);
  assert.ok(Math.abs(footballExpectedPointsPerDrive(base) - base) < 1e-9);
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
