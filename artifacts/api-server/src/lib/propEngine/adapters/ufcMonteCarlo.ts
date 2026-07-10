// UFC fight prop Monte Carlo — method/round/sig-strike props from career rates.

import { buildFightAnalysis } from "../../ufc.js";
import type { PropLine, PropSimResult } from "../types.js";
import { DEFAULT_SIMULATIONS } from "../../monteCarlo.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type UfcFightContext = Awaited<ReturnType<typeof buildFightAnalysis>>;

export async function runUfcPropMonteCarlo(
  line: PropLine,
  ctx: UfcFightContext,
  simulations = DEFAULT_SIMULATIONS,
): Promise<PropSimResult> {
  const n = simulations;
  const subject = line.subject;
  const isAway =
    ctx.away.resolvedName === subject ||
    ctx.away.name.toLowerCase() === subject.toLowerCase();
  const fighter = isAway ? ctx.away : ctx.home;
  const opp = isAway ? ctx.home : ctx.away;

  let hits = 0;
  const market = line.market.toLowerCase();

  const finishRate = (fighter.stats.finishPct ?? 40) / 100;
  const strikeRate = fighter.stats.strikeLPM ?? 4;
  const expectedMins = 12.5; // 3-round average

  for (let i = 0; i < n; i++) {
    let val = 0;
    if (market.includes("sig_strike") || market.includes("significant_strike")) {
      val = Math.round(strikeRate * expectedMins * (0.85 + Math.random() * 0.3));
    } else if (market.includes("takedown")) {
      val = Math.round((fighter.stats.takedownAvg ?? 1) * (expectedMins / 15) * (0.7 + Math.random() * 0.6));
    } else if (market.includes("method") || market.includes("ko") || market.includes("submission")) {
      val = Math.random() < finishRate ? 1 : 0;
    } else if (market.includes("round")) {
      val = finishRate > 0.55 ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2);
    } else {
      // Generic: win-based binary
      const awayWin = Math.random() < (isAway ? 1 - 0.5 : 0.5);
      val = awayWin ? 1 : 0;
    }

    if (line.line == null) continue;
    const hit =
      line.side === "Over"
        ? val > line.line
        : line.side === "Under"
          ? val < line.line
          : line.side === "Yes"
            ? val >= 1
            : val < 1;
    if (hit) hits++;
  }

  const hitProbability = line.line != null ? round3(hits / n) : null;

  let confidence = 40;
  if (fighter.record && opp.record) confidence += 12;
  if (fighter.stats.strikeAccuracy != null) confidence += 10;
  if (ctx.lean) confidence += 8;
  confidence = clamp(confidence, 35, 85);

  return {
    simulations: n,
    hitProbability,
    meanProjection: null,
    confidenceScore: confidence,
  };
}

export async function buildUfcFightContext(
  away: string,
  home: string,
): Promise<UfcFightContext | null> {
  try {
    return await buildFightAnalysis(away, home);
  } catch {
    return null;
  }
}
