// NFL / NCAAF — drive-by-drive simulation with red-zone efficiency and clock management.
//
// IMPORTANT (integrity): per-drive TD/FG rates hard-cap at 0.42 / 0.28 once
// points-per-drive (teamMean of ptsFor + opp ptsAgainst) reaches ~11.8 / ~11.2.
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

/** Pure scoring-rate map used by every drive draw (exported for deterministic audits). */
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

function driveOutcome(ppd: number): number {
  const r = Math.random();
  const { tdRate, fgRate } = nflDriveScoringRates(ppd);
  if (r < tdRate) return 7;
  if (r < tdRate + fgRate) return 3;
  return 0;
}

export function runNflDriveSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const homeOff = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, 22);
  const awayOff = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, 22);
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  const homeDrives = Math.round(10 + (homeOff + awayOff) / 55);
  const awayDrives = Math.round(10 + (homeOff + awayOff) / 55);
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    for (let d = 0; d < homeDrives; d++) {
      h += driveOutcome(homeOff);
      // Clock management — trailing team passes more (slightly higher variance).
      if (d > homeDrives * 0.7 && h < a) h += Math.random() < 0.08 ? 7 : 0;
    }
    for (let d = 0; d < awayDrives; d++) {
      a += driveOutcome(awayOff);
      if (d > awayDrives * 0.7 && a < h) a += Math.random() < 0.08 ? 7 : 0;
    }
    homeScores.push(h);
    awayScores.push(a);
  }

  return finalizeFromScores(ctx, homeScores, awayScores, {
    simModel: "nfl-drive",
    simModelLabel: "NFL drive-by-drive",
  }, 48);
}
