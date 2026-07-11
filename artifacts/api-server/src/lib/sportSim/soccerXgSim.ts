// Soccer — expected goals (xG) with possession share and match-state scoring.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";

function possessionShare(homeOff: number, awayOff: number): number {
  const total = homeOff + awayOff;
  if (total <= 0) return 0.5;
  return Math.max(0.32, Math.min(0.68, homeOff / total));
}

function shotScores(xg: number): boolean {
  return Math.random() < Math.max(0.02, Math.min(0.35, xg));
}

export function runSoccerXgSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const homeOff = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, 1.4);
  const awayOff = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, 1.4);
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  const poss = possessionShare(homeOff, awayOff);
  const homeShots = Math.round(10 + homeOff * 4);
  const awayShots = Math.round(10 + awayOff * 4);
  const homeXg = (homeOff / Math.max(0.8, homeShots * 0.11)) * 0.11;
  const awayXg = (awayOff / Math.max(0.8, awayShots * 0.11)) * 0.11;
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    const homeChances = Math.round(homeShots * (0.85 + poss * 0.3));
    const awayChances = Math.round(awayShots * (0.85 + (1 - poss) * 0.3));
    for (let c = 0; c < homeChances; c++) {
      if (shotScores(homeXg)) h += 1;
    }
    for (let c = 0; c < awayChances; c++) {
      if (shotScores(awayXg)) a += 1;
    }
    homeScores.push(h);
    awayScores.push(a);
  }

  return finalizeFromScores(ctx, homeScores, awayScores, {
    simModel: "soccer-xg",
    simModelLabel: "Soccer xG + possession",
  }, 44);
}
