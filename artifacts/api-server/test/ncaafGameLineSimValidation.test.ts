/**
 * NCAAF game-line engine validation (spreads / ML / totals sensitivity).
 *
 * These tests prove the recalibrated nfl-drive path responds to scoring form
 * and defense inputs. They do NOT lift client P0 —
 * `NCAAF_GAME_LINE_SIM_VALIDATED` stays false until human Phase E sign-off.
 * Player props alone never clear that gate.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import {
  blendVenueAndL10,
  footballDriveScoringRates,
} from "../src/lib/sportSim/footballDriveMatchup.ts";
import { teamInputFromHistory } from "../src/lib/sportSim/footballGameSimInputs.ts";

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  let i = seed >>> 0;
  Math.random = () => {
    i = (i * 1664525 + 1013904223) >>> 0;
    return i / 0x100000000;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

const baseHome = {
  ptsFor: 31,
  ptsAgainst: 18,
  recentScores: [28, 35, 24, 38, 27],
};
const baseAway = {
  ptsFor: 22,
  ptsAgainst: 27,
  recentScores: [17, 24, 21, 28, 14],
};

test("validation: soft rates remain strictly monotonic above former hard cap", () => {
  const a = footballDriveScoringRates(12);
  const b = footballDriveScoringRates(15);
  const c = footballDriveScoringRates(20);
  assert.ok(a.tdRate < b.tdRate && b.tdRate < c.tdRate);
  assert.ok(a.fgRate <= b.fgRate + 1e-9);
});

test("validation: +3 ppg home shock moves ML and spread cover ≥2pp", () => {
  const coverIds = [
    { id: "home-ml", kind: "ml" as const, teamSide: "home" as const },
    { id: "home-sp3", kind: "spread" as const, teamSide: "home" as const, line: -3 },
  ];
  const base = withSeededRandom(42, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 10000,
      home: baseHome,
      away: baseAway,
      coverQueries: coverIds,
      retainOutcomes: false,
    }),
  );
  const shocked = withSeededRandom(42, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 10000,
      home: { ...baseHome, ptsFor: (baseHome.ptsFor ?? 0) + 3 },
      away: baseAway,
      coverQueries: coverIds,
      retainOutcomes: false,
    }),
  );
  assert.ok(base && shocked);
  const mlDelta =
    (shocked!.coverHitRates?.["home-ml"] ?? 0) - (base!.coverHitRates?.["home-ml"] ?? 0);
  const spDelta =
    (shocked!.coverHitRates?.["home-sp3"] ?? 0) - (base!.coverHitRates?.["home-sp3"] ?? 0);
  assert.ok(mlDelta >= 0.02, `ML cover must move ≥2pp on +3 ppg, got ${mlDelta}`);
  assert.ok(spDelta >= 0.02, `spread cover must move ≥2pp on +3 ppg, got ${spDelta}`);
});

test("validation: QB-out proxy (−6 ptsFor) lowers home ML ≥2pp", () => {
  const q = [{ id: "home-ml", kind: "ml" as const, teamSide: "home" as const }];
  const healthy = withSeededRandom(7, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 10000,
      home: baseHome,
      away: baseAway,
      coverQueries: q,
      retainOutcomes: false,
    }),
  );
  const qbOut = withSeededRandom(7, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 10000,
      home: { ...baseHome, ptsFor: (baseHome.ptsFor ?? 0) - 6 },
      away: baseAway,
      coverQueries: q,
      retainOutcomes: false,
    }),
  );
  assert.ok(healthy && qbOut);
  const delta =
    (healthy!.coverHitRates?.["home-ml"] ?? 0) - (qbOut!.coverHitRates?.["home-ml"] ?? 0);
  assert.ok(delta >= 0.02, `QB-out proxy must drop home ML ≥2pp, got ${delta}`);
});

test("validation: totals over/under respond to combined scoring means", () => {
  const low = withSeededRandom(99, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 8000,
      home: { ptsFor: 17, ptsAgainst: 22, recentScores: [14, 17, 21] },
      away: { ptsFor: 14, ptsAgainst: 24, recentScores: [10, 17, 13] },
      coverQueries: [],
      retainOutcomes: false,
    }),
  );
  const high = withSeededRandom(99, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 8000,
      home: { ptsFor: 38, ptsAgainst: 28, recentScores: [42, 35, 31] },
      away: { ptsFor: 35, ptsAgainst: 31, recentScores: [38, 28, 41] },
      coverQueries: [],
      retainOutcomes: false,
    }),
  );
  assert.ok(low && high);
  const lowTotal =
    (low!.homeProjectedScore ?? 0) + (low!.awayProjectedScore ?? 0);
  const highTotal =
    (high!.homeProjectedScore ?? 0) + (high!.awayProjectedScore ?? 0);
  assert.ok(highTotal > lowTotal + 8, `high slate total must exceed low, ${highTotal} vs ${lowTotal}`);

  // Bind an OU line between the two projected totals and re-run cover rates.
  const midLine = Math.round(((lowTotal + highTotal) / 2) * 2) / 2;
  const totalQ = [
    { id: "ou-over", kind: "total" as const, totalSide: "over" as const, line: midLine },
  ];
  const lowCover = withSeededRandom(99, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 8000,
      home: { ptsFor: 17, ptsAgainst: 22, recentScores: [14, 17, 21] },
      away: { ptsFor: 14, ptsAgainst: 24, recentScores: [10, 17, 13] },
      coverQueries: totalQ,
      retainOutcomes: false,
    }),
  );
  const highCover = withSeededRandom(99, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 8000,
      home: { ptsFor: 38, ptsAgainst: 28, recentScores: [42, 35, 31] },
      away: { ptsFor: 35, ptsAgainst: 31, recentScores: [38, 28, 41] },
      coverQueries: totalQ,
      retainOutcomes: false,
    }),
  );
  const lowOver = lowCover!.coverHitRates?.["ou-over"] ?? 0;
  const highOver = highCover!.coverHitRates?.["ou-over"] ?? 0;
  assert.ok(
    highOver > lowOver + 0.08,
    `high-scoring slate must boost over @ ${midLine}, ${highOver} vs ${lowOver}`,
  );
});

test("validation: moneylines track form (ties excluded from side covers)", () => {
  const result = withSeededRandom(3, () =>
    runNflDriveSim({
      sport: "ncaaf",
      simulations: 10000,
      home: baseHome,
      away: baseAway,
      coverQueries: [
        { id: "h", kind: "ml", teamSide: "home" },
        { id: "a", kind: "ml", teamSide: "away" },
      ],
      retainOutcomes: false,
    }),
  );
  assert.ok(result);
  const h = result!.coverHitRates?.h ?? 0;
  const a = result!.coverHitRates?.a ?? 0;
  // ML covers exclude ties — sum < 1 is expected.
  assert.ok(h + a > 0.9 && h + a <= 1.001, `ML sum ${h + a}`);
  assert.ok(h > a, "stronger home form should be ML favorite");
  assert.ok(
    Math.abs((result!.homeWinProbability ?? 0) - h) < 0.02,
    "home ML cover should track homeWinProbability",
  );
});

test("validation: sparse venue split blends with L10 (not dominate)", () => {
  const thin = blendVenueAndL10(
    { games: 1, ptsFor: 55, ptsAgainst: 10 },
    { games: 10, ptsFor: 24, ptsAgainst: 22 },
  );
  assert.equal(thin.provenance, "venue_l10_blend");
  assert.ok(thin.ptsFor != null && thin.ptsFor < 40, "single blowout must not dominate");
  assert.ok(Math.abs((thin.ptsFor ?? 0) - (55 * 0.3 + 24 * 0.7)) < 1e-9);

  const rich = blendVenueAndL10(
    { games: 4, ptsFor: 30, ptsAgainst: 20 },
    { games: 10, ptsFor: 24, ptsAgainst: 22 },
  );
  assert.equal(rich.provenance, "venue_split");
  assert.equal(rich.ptsFor, 30);
});

test("validation: teamInputFromHistory wires defenseAllowed through", () => {
  const def = {
    rushingYardsAllowedPerGame: 120,
    passingYardsAllowedPerGame: 220,
    rushSampleSize: 4,
    passSampleSize: 4,
  };
  const input = teamInputFromHistory(
    {
      homeSplit: { games: 3, ptsFor: 28, ptsAgainst: 19 },
      last10: { games: 10, ptsFor: 26, ptsAgainst: 21 },
      recent: [{ pts: 31 }, { pts: 24 }],
    },
    "home",
    def,
  );
  assert.equal(input.ptsFor, 28);
  assert.deepEqual(input.defenseAllowed, def);
  assert.deepEqual(input.recentScores, [31, 24]);
});

test("validation seal: client P0 flag must stay false until Phase E sign-off", async () => {
  const mod = await import("../../stadium-mobile/lib/coachP0UnvalidatedTotals.ts");
  assert.equal(
    mod.NCAAF_GAME_LINE_SIM_VALIDATED,
    false,
    "Do not lift NCAAF_GAME_LINE_SIM_VALIDATED without human Phase E approval",
  );
  assert.equal(
    mod.isP0UnvalidatedNcaafGameLineMarket({ market: "Spread", sport: "ncaaf" }),
    true,
    "P0 must remain armed for NCAAF spreads while flag is false",
  );
  assert.equal(
    mod.isP0UnvalidatedNcaafGameLineMarket({ market: "Moneyline", sport: "ncaaf" }),
    true,
  );
});
