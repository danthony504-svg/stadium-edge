// NBA / WNBA — possession-by-possession scoring with pace and late-game foul bonus.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";

function possessionsPerGame(homeOff: number, awayOff: number, homeDef: number, awayDef: number): number {
  const pace = (homeOff + awayOff + homeDef + awayDef) / 2;
  return Math.round(Math.max(88, Math.min(108, pace * 0.92)));
}

function pointsPerPossession(offRating: number, defRating: number): number {
  const eff = offRating / Math.max(95, defRating);
  const ppp = Math.max(0.85, Math.min(1.35, 1.05 * eff));
  const r = Math.random();
  if (r > ppp / 1.15) return 0;
  if (r > ppp / 2.4) return Math.random() < 0.32 ? 3 : 2;
  return 2;
}

export function runPossessionSim(
  ctx: SportSimContext,
  modelId: "nba-possession" | "wnba-possession",
): GameSimResult | null {
  const n = simCount(ctx);
  const homeOff = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, 110);
  const awayOff = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, 110);
  const homeDef = ctx.home.ptsAgainst ?? homeOff;
  const awayDef = ctx.away.ptsAgainst ?? awayOff;
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  const poss = possessionsPerGame(homeOff, awayOff, homeDef, awayDef);
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    for (let p = 0; p < poss; p++) {
      const q4FoulBonus = p >= poss * 0.75 ? 1.06 : 1;
      if (Math.random() < 0.5) {
        h += pointsPerPossession(homeOff * q4FoulBonus, awayDef);
      } else {
        a += pointsPerPossession(awayOff * q4FoulBonus, homeDef);
      }
    }
    homeScores.push(Math.round(h));
    awayScores.push(Math.round(a));
  }

  return finalizeFromScores(ctx, homeScores, awayScores, {
    simModel: modelId,
    simModelLabel: modelId === "wnba-possession" ? "WNBA possession model" : "NBA possession model",
  }, 50);
}
