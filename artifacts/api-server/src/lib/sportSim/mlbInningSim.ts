// MLB — inning-by-inning run expectancy with starter fatigue and bullpen usage.

import type { GameSimResult } from "../gameMonteCarlo.js";
import type { SportSimContext } from "./types.js";
import { finalizeFromScores, simCount, teamMean } from "./shared.js";

const INNINGS = 9;

/** Starter effectiveness decays after the 5th; bullpen arms used 7th–9th. */
function pitcherFatigue(inning: number): { homePitch: number; awayPitch: number } {
  if (inning <= 5) return { homePitch: 1, awayPitch: 1 };
  if (inning <= 7) return { homePitch: 0.94, awayPitch: 0.94 };
  return { homePitch: 0.9, awayPitch: 0.9 };
}

function inningRuns(lambda: number, fatigue: number): number {
  const adj = Math.max(0.15, lambda * fatigue);
  const L = Math.exp(-adj);
  let p = 1;
  let k = 0;
  while (p > L) {
    k += 1;
    p *= Math.random();
  }
  return Math.max(0, k - 1);
}

export function runMlbInningSim(ctx: SportSimContext): GameSimResult | null {
  const n = simCount(ctx);
  const homeOff = teamMean(ctx.home.ptsFor, ctx.away.ptsAgainst, 4.5);
  const awayOff = teamMean(ctx.away.ptsFor, ctx.home.ptsAgainst, 4.5);
  if (!Number.isFinite(homeOff) || !Number.isFinite(awayOff)) return null;

  let weatherMul = 1;
  if (ctx.weatherImpact != null) {
    weatherMul = 1 + Math.max(-1, Math.min(1, ctx.weatherImpact)) * 0.08;
  }

  const homePerInning = (homeOff / INNINGS) * weatherMul;
  const awayPerInning = (awayOff / INNINGS) * weatherMul;
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    let h = 0;
    let a = 0;
    for (let inn = 1; inn <= INNINGS; inn++) {
      const fat = pitcherFatigue(inn);
      // Home bats in bottom half — away pitcher fatigues on awayPitch multiplier.
      h += inningRuns(homePerInning, fat.awayPitch);
      a += inningRuns(awayPerInning, fat.homePitch);
    }
    homeScores.push(Math.round(h * 10) / 10);
    awayScores.push(Math.round(a * 10) / 10);
  }

  return finalizeFromScores(ctx, homeScores, awayScores, {
    simModel: "mlb-inning",
    simModelLabel: "MLB inning-by-inning",
  }, 52);
}
