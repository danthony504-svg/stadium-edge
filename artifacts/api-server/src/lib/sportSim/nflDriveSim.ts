// NFL — drive-by-drive simulation with red-zone efficiency and clock management.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";

function driveOutcome(ppd: number): number {
  const r = Math.random();
  const tdRate = Math.min(0.42, ppd / 28);
  const fgRate = Math.min(0.28, ppd / 40);
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
