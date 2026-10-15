/**
 * Points-per-game → drives → exclusive TD/FG/XP → simulated score.
 * Market prices are not an input.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { runNflDriveSim } from "../src/lib/sportSim/nflDriveSim.ts";
import { runSportGameMonteCarlo } from "../src/lib/sportSim/registry.ts";
import {
  gameDrawEngineAccepted,
  stampedTeamGameOutcome,
} from "../src/lib/sportSim/gameSimEngineVersion.ts";
import {
  footballDrivePoints,
  footballDriveRateInput,
  footballDriveScoringRates,
  footballExpectedDrives,
  footballLateClockDriveCount,
  footballLateClockPointsBudget,
} from "../src/lib/sportSim/footballDriveMatchup.ts";

function withRandom<T>(rng: () => number, fn: () => T): T {
  const real = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

function budgetedPpd(sport: string, own: number, opp: number) {
  const drives = footballExpectedDrives(own, opp, sport);
  const { tdPoints } = footballDrivePoints(sport);
  const lateClockTd = sport === "ncaaf" || sport === "cfb" ? 0.04 : 0.08;
  const late = footballLateClockPointsBudget({
    drives,
    ownPointsPerGame: own,
    opponentPointsPerGame: opp,
    lateClockTd,
    tdPoints,
  });
  const ppd = footballDriveRateInput(Math.max(0, own - late), drives, sport);
  const rates = footballDriveScoringRates(ppd, sport);
  return { drives, late, ppd, rates, lateClockTd, tdPoints };
}

/** Pre-fix soft map: PPG (or PPG×0.48 in college) treated as points per drive, flat 7 for a TD. */
function legacySoftMean(ppg: number, drives: number, college: boolean): number {
  const input = college ? ppg * 0.48 : ppg;
  const soft = (linear: number, knee: number, max: number) => {
    if (linear <= knee) return Math.min(max, Math.max(0, linear));
    return Math.min(max, Math.max(0, knee + (linear - knee) * 0.5));
  };
  const td = soft(input / 28, 0.42, 0.72);
  const fg = Math.min(soft(input / 40, 0.28, 0.3), Math.max(0, 0.98 - td));
  return drives * (td * 7 + fg * 3);
}

/** Hosted hard cap: PPG treated as points per drive, knees at 0.42 / 0.28, flat 7. */
function legacyHardCapMean(ppg: number, drives: number): number {
  const td = Math.min(0.42, Math.max(0, ppg) / 28);
  const fg = Math.min(0.28, Math.max(0, ppg) / 40);
  return drives * (td * 7 + fg * 3);
}

function project(sport: string, home: number, away: number, simulations: number) {
  const result = runNflDriveSim({
    sport,
    simulations,
    home: { ptsFor: home, ptsAgainst: null, recentScores: [home, home, home] },
    away: { ptsFor: away, ptsAgainst: null, recentScores: [away, away, away] },
    retainOutcomes: false,
  });
  assert.ok(result);
  return {
    home: result!.homeProjectedScore ?? 0,
    away: result!.awayProjectedScore ?? 0,
    label: result!.simModelLabel,
  };
}

test("drive events are one TD with one XP, one FG, or nothing", () => {
  const sport = "nfl";
  const own = 22;
  const opp = 22;
  const { drives, rates } = budgetedPpd(sport, own, opp);
  const input = {
    sport,
    simulations: 4,
    home: { ptsFor: own, ptsAgainst: null },
    away: { ptsFor: opp, ptsAgainst: null },
    retainOutcomes: false,
  };

  const alwaysTd = withRandom(() => 0, () => runNflDriveSim(input));
  assert.equal(alwaysTd?.homeProjectedScore, 7 * drives);
  assert.equal(alwaysTd?.awayProjectedScore, 7 * drives);

  let call = 0;
  const missedXp = withRandom(
    () => {
      call += 1;
      return call % 2 === 1 ? 0 : 0.97;
    },
    () => runNflDriveSim(input),
  );
  assert.equal(missedXp?.homeProjectedScore, 6 * drives);
  assert.equal(missedXp?.awayProjectedScore, 6 * drives);

  const fgRoll = rates.tdRate + rates.fgRate / 2;
  const alwaysFg = withRandom(() => fgRoll, () => runNflDriveSim(input));
  assert.equal(alwaysFg?.homeProjectedScore, 3 * drives);
  assert.equal(alwaysFg?.awayProjectedScore, 3 * drives);

  const blank = withRandom(() => 0.99, () => runNflDriveSim(input));
  assert.equal(blank?.homeProjectedScore, 0);
  assert.equal(blank?.awayProjectedScore, 0);
});

test("10k draws track low, average, and high points per game", () => {
  const sims = 10_000;
  const fixtures: Array<{ sport: string; home: number; away: number; band: string }> = [
    { sport: "nfl", band: "low", home: 14, away: 14 },
    { sport: "nfl", band: "average", home: 22, away: 22 },
    { sport: "nfl", band: "high", home: 31, away: 28 },
    { sport: "nfl", band: "mismatch", home: 20.7, away: 25.8 },
    { sport: "ncaaf", band: "low", home: 17, away: 14 },
    { sport: "ncaaf", band: "average", home: 24, away: 24 },
    { sport: "ncaaf", band: "high", home: 35, away: 31 },
  ];

  const rows = fixtures.map((fx) => {
    const homeBudget = budgetedPpd(fx.sport, fx.home, fx.away);
    const awayBudget = budgetedPpd(fx.sport, fx.away, fx.home);
    const projected = project(fx.sport, fx.home, fx.away, sims);
    return {
      ...fx,
      drives: homeBudget.drives,
      lateDrives: footballLateClockDriveCount(homeBudget.drives),
      homePpd: homeBudget.ppd,
      awayPpd: awayBudget.ppd,
      projectedHome: projected.home,
      projectedAway: projected.away,
      homeDelta: projected.home - fx.home,
      awayDelta: projected.away - fx.away,
      label: projected.label,
      legacyHardCapHome: legacyHardCapMean(fx.home, homeBudget.drives),
      legacyHardCapAway: legacyHardCapMean(fx.away, awayBudget.drives),
      legacySoftHome: legacySoftMean(fx.home, homeBudget.drives, fx.sport === "ncaaf"),
      legacySoftAway: legacySoftMean(fx.away, awayBudget.drives, fx.sport === "ncaaf"),
    };
  });

  for (const row of rows) {
    assert.match(String(row.label), /ppg-per-drive-v1/);
    assert.ok(
      Math.abs(row.homeDelta) <= 1.25,
      `${row.sport} ${row.band} home ${row.projectedHome} vs input ${row.home} (delta ${row.homeDelta})`,
    );
    assert.ok(
      Math.abs(row.awayDelta) <= 1.25,
      `${row.sport} ${row.band} away ${row.projectedAway} vs input ${row.away} (delta ${row.awayDelta})`,
    );
    if (row.home >= 12) {
      assert.ok(
        Math.abs(row.legacyHardCapHome - 3.78 * row.drives) < 0.02,
        `${row.sport} ${row.band} hard cap ${row.legacyHardCapHome} should be 3.78 per drive`,
      );
    }
  }

  const nflAvg = rows.find((r) => r.sport === "nfl" && r.band === "average")!;
  const nflPlus = project("nfl", 25, 22, sims);
  assert.ok(
    Math.abs(nflPlus.home - 25) <= 1.25,
    `+3 PPG home projected ${nflPlus.home}`,
  );
  assert.ok(
    nflPlus.home - nflAvg.projectedHome > 2.2 && nflPlus.home - nflAvg.projectedHome < 3.8,
    `+3 PPG should move the home mean by about 3, delta ${nflPlus.home - nflAvg.projectedHome}`,
  );

  const collegeAvg = rows.find((r) => r.sport === "ncaaf" && r.band === "average")!;
  assert.ok(
    collegeAvg.projectedHome > 22 && collegeAvg.projectedHome < 26,
    `college 24 PPG projected ${collegeAvg.projectedHome}`,
  );

  const payload = {
    engine: "ppg-per-drive-v1",
    simulations: sims,
    tolerancePoints: 1.25,
    rows,
    plus3: {
      homeInput: 25,
      awayInput: 22,
      projectedHome: nflPlus.home,
      projectedAway: nflPlus.away,
      homeMoveFromAverage: nflPlus.home - nflAvg.projectedHome,
    },
  };
  console.log(JSON.stringify(payload));
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/nfl-drive-score-distributions.json",
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  } catch {
    // Artifact dir is local to this agent run.
  }
});

test("HTTP registry and in-process model id share the corrected drive engine", () => {
  const viaRegistry = runSportGameMonteCarlo({
    sport: "nfl",
    simulations: 200,
    home: { ptsFor: 21, ptsAgainst: null },
    away: { ptsFor: 21, ptsAgainst: null },
    retainOutcomes: false,
  });
  const college = runSportGameMonteCarlo({
    sport: "ncaaf",
    simulations: 200,
    home: { ptsFor: 24, ptsAgainst: null },
    away: { ptsFor: 24, ptsAgainst: null },
    retainOutcomes: false,
  });
  assert.match(viaRegistry?.simModelLabel ?? "", /ppg-per-drive-v1/);
  assert.match(college?.simModelLabel ?? "", /ppg-per-drive-v1/);
  assert.equal(viaRegistry?.simModel, "nfl-drive");
  assert.equal(college?.simModel, "nfl-drive");
  assert.equal(viaRegistry?.engineVersion, "ppg-per-drive-v1");
  assert.equal(college?.engineVersion, "ppg-per-drive-v1");
  const httpBody = JSON.parse(
    JSON.stringify({
      sport: "nfl",
      homeTeam: "Home",
      awayTeam: "Away",
      ...viaRegistry,
    }),
  ) as { engineVersion?: string; sport?: string };
  assert.equal(httpBody.engineVersion, "ppg-per-drive-v1");
  assert.equal(gameDrawEngineAccepted(httpBody, "nfl"), true);
  const inProcess = JSON.parse(
    JSON.stringify(stampedTeamGameOutcome("ncaaf", college!)),
  ) as { engineVersion?: string; sport?: string };
  assert.equal(inProcess.sport, "ncaaf");
  assert.equal(inProcess.engineVersion, "ppg-per-drive-v1");
  assert.equal(gameDrawEngineAccepted(inProcess, "ncaaf"), true);
  assert.equal(gameDrawEngineAccepted({ ...httpBody, engineVersion: undefined }, "nfl"), false);
  assert.ok(Math.abs((viaRegistry?.homeProjectedScore ?? 0) - 21) < 4);
  assert.ok(Math.abs((college?.homeProjectedScore ?? 0) - 24) < 5);
});
