// NFL / NCAAF — drive-by-drive scoring simulation.
//
// The legacy NCAAF path passes game-level points into rates that hard-cap at 0.42 / 0.28 once
// their scoring input at ~11.8 / ~11.2.
// Above those floors, large offensive / defensive / QB shocks do not change
// scoring rates — cover probabilities become insensitive. NCAAF game-line
// grades fail closed on the client until this engine is recalibrated.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";

/** TD rate hard cap — ppd ≥ 0.42 * 28 ≈ 11.76 saturates. */
export const NFL_DRIVE_TD_RATE_CAP = 0.42;
/** FG rate hard cap — ppd ≥ 0.28 * 40 ≈ 11.2 saturates. */
export const NFL_DRIVE_FG_RATE_CAP = 0.28;
export const NFL_DRIVE_TD_PPD_DIVISOR = 28;
export const NFL_DRIVE_FG_PPD_DIVISOR = 40;

/** Scoring-rate map shared by the NFL and legacy NCAAF drive samplers. */
export function nflDriveScoringRates(ppd: number): { tdRate: number; fgRate: number } {
  return {
    tdRate: Math.min(NFL_DRIVE_TD_RATE_CAP, ppd / NFL_DRIVE_TD_PPD_DIVISOR),
    fgRate: Math.min(NFL_DRIVE_FG_RATE_CAP, ppd / NFL_DRIVE_FG_PPD_DIVISOR),
  };
}

/** True when both TD and FG rates are at their hard caps (further ppd increases are NOOP). */
export function nflDriveRatesSaturated(ppd: number): boolean {
  const { tdRate, fgRate } = nflDriveScoringRates(ppd);
  return tdRate >= NFL_DRIVE_TD_RATE_CAP && fgRate >= NFL_DRIVE_FG_RATE_CAP;
}

// Below the caps, each unit of input contributes this many expected drive points.
const POINTS_PER_RATE_INPUT = 7 / NFL_DRIVE_TD_PPD_DIVISOR + 3 / NFL_DRIVE_FG_PPD_DIVISOR;

function driveOutcome({ tdRate, fgRate }: ReturnType<typeof nflDriveScoringRates>): number {
  const r = Math.random();
  if (r < tdRate) return 7;
  if (r < tdRate + fgRate) return 3;
  return 0;
}

export function runNflDriveSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const homeOff = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, 22);
  const awayOff = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, 22);
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  const isNfl = ctx.sport.toLowerCase() === "nfl";
  const drivesPerTeam = Math.max(1, Math.round(10 + (homeOff + awayOff) / 55));
  // Convert each NFL team's expected game points to a drive scoring rate.
  const rateScale = isNfl ? drivesPerTeam * POINTS_PER_RATE_INPUT : 1;
  const homeRates = nflDriveScoringRates(Math.max(0, homeOff) / rateScale);
  const awayRates = nflDriveScoringRates(Math.max(0, awayOff) / rateScale);
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  // Interleave each team's drive results for display while preserving the draw order.
  const driveReplay: GameSimResult["driveReplay"] =
    isNfl && ctx.includeDriveReplay ? [] : undefined;

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    for (let d = 0; d < drivesPerTeam; d++) {
      const before = h;
      h += driveOutcome(homeRates);
      // Clock management — trailing team passes more (slightly higher variance).
      if (!isNfl && d > drivesPerTeam * 0.7 && h < a) h += Math.random() < 0.08 ? 7 : 0;
      if (driveReplay && i === 0) driveReplay[2 * d + 1] = { side: "home", points: h - before };
    }
    for (let d = 0; d < drivesPerTeam; d++) {
      const before = a;
      a += driveOutcome(awayRates);
      if (!isNfl && d > drivesPerTeam * 0.7 && a < h) a += Math.random() < 0.08 ? 7 : 0;
      if (driveReplay && i === 0) driveReplay[2 * d] = { side: "away", points: a - before };
    }
    homeScores.push(h);
    awayScores.push(a);
  }

  const result = finalizeFromScores(ctx, homeScores, awayScores, {
    simModel: "nfl-drive",
    simModelLabel: "NFL drive-by-drive",
  }, 48);
  return driveReplay?.length ? { ...result, driveReplay } : result;
}
