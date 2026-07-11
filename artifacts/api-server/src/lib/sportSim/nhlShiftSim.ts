// NHL — shift-by-shift scoring with goalie save performance.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";

const SHIFTS = 60;

function goalChance(xgPerShift: number, savePct: number): boolean {
  const prob = xgPerShift * (1 - savePct);
  return Math.random() < Math.max(0.001, Math.min(0.12, prob));
}

export function runNhlShiftSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const homeOff = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, 3.1);
  const awayOff = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, 3.1);
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  const homeXg = homeOff / SHIFTS;
  const awayXg = awayOff / SHIFTS;
  const homeSave = Math.min(0.94, 0.88 + (ctx.home.ptsAgainst != null ? (4.5 - ctx.home.ptsAgainst) * 0.02 : 0));
  const awaySave = Math.min(0.94, 0.88 + (ctx.away.ptsAgainst != null ? (4.5 - ctx.away.ptsAgainst) * 0.02 : 0));
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    for (let s = 0; s < SHIFTS; s++) {
      if (goalChance(homeXg, awaySave)) h += 1;
      if (goalChance(awayXg, homeSave)) a += 1;
    }
    homeScores.push(h);
    awayScores.push(a);
  }

  return finalizeFromScores(ctx, homeScores, awayScores, {
    simModel: "nhl-shift",
    simModelLabel: "NHL shift-by-shift",
  }, 46);
}
