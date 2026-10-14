// NFL / NCAAF — drive-by-drive simulation with red-zone efficiency and clock management.
//
// Integrity history: per-drive TD/FG rates formerly hard-capped at 0.42 / 0.28 once
// points-per-drive reached ~11.8 / ~11.2, so large offensive / defensive / QB shocks
// did not change scoring rates. Rates are now soft-monotonic (see footballDriveMatchup)
// and optional defense yards-allowed packs tilt opposing offense means (±8%).
//
// Client P0 for NCAAF game lines stays armed until ncaafGameLineSimValidation passes
// and NCAAF_GAME_LINE_SIM_VALIDATED is flipped.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";
import {
  applyDefenseTiltToOffenseMean,
  footballDriveRateInput,
  footballDriveRatesPastKnee,
  footballDriveScoringRates,
  FOOTBALL_DRIVE_FG_RATE_KNEE,
  FOOTBALL_DRIVE_TD_RATE_KNEE,
  FOOTBALL_DRIVE_TD_PPD_DIVISOR,
} from "./footballDriveMatchup.js";

/** @deprecated Use FOOTBALL_DRIVE_* — kept for existing test imports. */
export const NFL_DRIVE_TD_RATE_CAP = FOOTBALL_DRIVE_TD_RATE_KNEE;
export const NFL_DRIVE_FG_RATE_CAP = FOOTBALL_DRIVE_FG_RATE_KNEE;
export const NFL_DRIVE_TD_PPD_DIVISOR = FOOTBALL_DRIVE_TD_PPD_DIVISOR;
export const NFL_DRIVE_FG_PPD_DIVISOR = 40;

export function nflDriveScoringRates(ppd: number): { tdRate: number; fgRate: number } {
  return footballDriveScoringRates(ppd);
}

/** True when ppd is past the former hard-cap knee (rates still increase slowly). */
export function nflDriveRatesSaturated(ppd: number): boolean {
  return footballDriveRatesPastKnee(ppd);
}

function driveOutcome(rateInput: number): number {
  const r = Math.random();
  const { tdRate, fgRate } = footballDriveScoringRates(rateInput);
  if (r < tdRate) return 7;
  if (r < tdRate + fgRate) return 3;
  return 0;
}

function isCollegeFootball(sport: string): boolean {
  const s = String(sport ?? "").toLowerCase();
  return s === "ncaaf" || s === "cfb" || s.includes("ncaaf");
}

export function runNflDriveSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const college = isCollegeFootball(ctx.sport);
  // Base means from scoring form; opponent defense yards tilt when sample ≥ 2.
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

  // College: fewer drives + scaled rate inputs so projected means track FBS.
  const driveScale = college ? 70 : 55;
  const driveBase = college ? 10 : 10;
  const homeDrives = Math.round(driveBase + (homeOff + awayOff) / driveScale);
  const awayDrives = Math.round(driveBase + (homeOff + awayOff) / driveScale);
  const homeRate = footballDriveRateInput(homeOff, ctx.sport);
  const awayRate = footballDriveRateInput(awayOff, ctx.sport);
  const lateClockTd = college ? 0.04 : 0.08;
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    for (let d = 0; d < homeDrives; d++) {
      h += driveOutcome(homeRate);
      if (d > homeDrives * 0.7 && h < a) h += Math.random() < lateClockTd ? 7 : 0;
    }
    for (let d = 0; d < awayDrives; d++) {
      a += driveOutcome(awayRate);
      if (d > awayDrives * 0.7 && a < h) a += Math.random() < lateClockTd ? 7 : 0;
    }
    homeScores.push(h);
    awayScores.push(a);
  }

  return finalizeFromScores(
    ctx,
    homeScores,
    awayScores,
    {
      simModel: "nfl-drive",
      simModelLabel: college ? "NCAAF drive-by-drive" : "NFL drive-by-drive",
    },
    48,
  );
}
