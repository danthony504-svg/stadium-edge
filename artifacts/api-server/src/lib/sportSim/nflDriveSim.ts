// NFL / NCAAF — drive-by-drive simulation.
//
// Units: team means are points per game. Those means become points per drive
// by dividing by the drive count that the loop will run. Each drive then
// scores a touchdown (6 plus one extra point), a field goal (3), or nothing.
// The late-clock touchdown is paid for out of that same points budget.
//
// Client P0 for NCAAF game lines stays armed until ncaafGameLineSimValidation
// passes and NCAAF_GAME_LINE_SIM_VALIDATED is flipped.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";
import {
  applyDefenseTiltToOffenseMean,
  footballDrivePoints,
  footballDriveRateInput,
  footballDriveRatesPastKnee,
  footballDriveScoringRates,
  footballExpectedDrives,
  footballLateClockPointsBudget,
  FOOTBALL_DRIVE_ENGINE_VERSION,
  FOOTBALL_DRIVE_FG_RATE_KNEE,
  FOOTBALL_DRIVE_TD_RATE_KNEE,
  FOOTBALL_DRIVE_TD_PPD_DIVISOR,
  isCollegeFootballSport,
} from "./footballDriveMatchup.js";

/** @deprecated Use FOOTBALL_DRIVE_* — kept for existing test imports. */
export const NFL_DRIVE_TD_RATE_CAP = FOOTBALL_DRIVE_TD_RATE_KNEE;
export const NFL_DRIVE_FG_RATE_CAP = FOOTBALL_DRIVE_FG_RATE_KNEE;
export const NFL_DRIVE_TD_PPD_DIVISOR = FOOTBALL_DRIVE_TD_PPD_DIVISOR;
export const NFL_DRIVE_FG_PPD_DIVISOR = 40;

export function nflDriveScoringRates(ppd: number): { tdRate: number; fgRate: number } {
  return footballDriveScoringRates(ppd);
}

/** True when points-per-drive is high enough to hit the joint TD+FG ceiling. */
export function nflDriveRatesSaturated(ppd: number, sport = "nfl"): boolean {
  return footballDriveRatesPastKnee(ppd, sport);
}

/** One touchdown: 6 points plus a single extra-point attempt. No second XP. */
function scoreTouchdown(sport: string, rng: () => number): number {
  const { tdPoints } = footballDrivePoints(sport);
  const xpExpected = tdPoints - 6;
  const xp = rng() < xpExpected ? 1 : 0;
  return 6 + xp;
}

function driveOutcome(pointsPerDrive: number, sport: string, rng: () => number): number {
  const r = rng();
  const { tdRate, fgRate } = footballDriveScoringRates(pointsPerDrive, sport);
  const { fgPoints } = footballDrivePoints(sport);
  if (r < tdRate) return scoreTouchdown(sport, rng);
  if (r < tdRate + fgRate) return fgPoints;
  return 0;
}

export function runNflDriveSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const college = isCollegeFootballSport(ctx.sport);
  // Base means are points per game; opponent defense yards tilt when sample ≥ 2.
  const homeBase = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, college ? 24 : 22);
  const awayBase = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, college ? 24 : 22);
  const homeOff = applyDefenseTiltToOffenseMean(
    homeBase,
    ctx.away.defenseAllowed ?? null,
    ctx.sport,
  );
  const awayOff = applyDefenseTiltToOffenseMean(
    awayBase,
    ctx.home.defenseAllowed ?? null,
    ctx.sport,
  );
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  const drives = footballExpectedDrives(homeOff, awayOff, ctx.sport);
  const { tdPoints } = footballDrivePoints(ctx.sport);
  const lateClockTd = college ? 0.04 : 0.08;
  const homeLate = footballLateClockPointsBudget({
    drives,
    ownPointsPerGame: homeOff,
    opponentPointsPerGame: awayOff,
    lateClockTd,
    tdPoints,
  });
  const awayLate = footballLateClockPointsBudget({
    drives,
    ownPointsPerGame: awayOff,
    opponentPointsPerGame: homeOff,
    lateClockTd,
    tdPoints,
  });
  const homeRate = footballDriveRateInput(homeOff - homeLate, drives, ctx.sport);
  const awayRate = footballDriveRateInput(awayOff - awayLate, drives, ctx.sport);
  const rng = ctx.random ?? Math.random;
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    // Alternate possessions. A home-then-away sweep leaves away at 0 for the
    // whole home sequence, so the home trailing check never fires and the
    // home late-clock budget is subtracted without being scored.
    for (let d = 0; d < drives; d++) {
      h += driveOutcome(homeRate, ctx.sport, rng);
      if (d > drives * 0.7 && h < a) {
        h += rng() < lateClockTd ? scoreTouchdown(ctx.sport, rng) : 0;
      }
      a += driveOutcome(awayRate, ctx.sport, rng);
      if (d > drives * 0.7 && a < h) {
        a += rng() < lateClockTd ? scoreTouchdown(ctx.sport, rng) : 0;
      }
    }
    homeScores.push(h);
    awayScores.push(a);
  }

  const label = college ? "NCAAF" : "NFL";
  return finalizeFromScores(
    ctx,
    homeScores,
    awayScores,
    {
      simModel: "nfl-drive",
      simModelLabel: `${label} drive-by-drive (${FOOTBALL_DRIVE_ENGINE_VERSION})`,
    },
    48,
  );
}
