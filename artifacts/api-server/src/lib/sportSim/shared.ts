// Shared helpers — turn per-draw score arrays into the standard GameSimResult.

import { DEFAULT_SIMULATIONS } from "../monteCarlo.js";
import {
  deriveCoverHitRates,
  type GameCoverQuery,
  type GameSimResult,
} from "../gameMonteCarlo.js";
import type { SportSimContext, SportSimModelId, SportSimResultMeta } from "./types.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function teamMean(forPts: number | null, oppAgainst: number | null, fallback: number): number {
  const parts = [forPts, oppAgainst].filter((v): v is number => v != null && Number.isFinite(v));
  if (!parts.length) return fallback;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function finalizeFromScores(
  ctx: SportSimContext,
  homeScores: number[],
  awayScores: number[],
  meta: SportSimResultMeta,
  confidenceBase: number,
): GameSimResult & SportSimResultMeta {
  const n = homeScores.length;
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  let homeTotal = 0;
  let awayTotal = 0;

  for (let i = 0; i < n; i++) {
    const hs = homeScores[i]!;
    const as = awayScores[i]!;
    homeTotal += hs;
    awayTotal += as;
    if (Math.abs(hs - as) < 0.01) ties += 1;
    else if (hs > as) homeWins += 1;
    else awayWins += 1;
  }

  const winner = homeWins >= awayWins ? "home" : "away";
  const winnerPct = (winner === "home" ? homeWins : awayWins) / n;
  const coverQueries = ctx.coverQueries ?? [];
  const outcomes = { homeScores, awayScores };
  const coverHitRates =
    coverQueries.length > 0
      ? deriveCoverHitRates(outcomes, coverQueries, ctx.sport)
      : undefined;

  let confidence = confidenceBase;
  if ((ctx.home.recentScores?.length ?? 0) >= 5) confidence += 8;
  if ((ctx.away.recentScores?.length ?? 0) >= 5) confidence += 8;
  confidence += Math.abs(homeWins / n - 0.5) * 40;

  return {
    ...meta,
    simulations: n,
    homeWinProbability: round3(homeWins / n),
    awayWinProbability: round3(awayWins / n),
    tieProbability: round3(ties / n),
    homeProjectedScore: round2(homeTotal / n),
    awayProjectedScore: round2(awayTotal / n),
    mostLikelyWinner: winner,
    mostLikelyWinnerPct: round3(winnerPct),
    confidenceScore: clamp(Math.round(confidence), 5, 95),
    ...(coverHitRates ? { coverHitRates } : {}),
    ...(ctx.retainOutcomes !== false ? { outcomes } : {}),
  };
}

export function simCount(ctx: SportSimContext): number {
  return ctx.simulations ?? DEFAULT_SIMULATIONS;
}

export const MODEL_LABELS: Record<SportSimModelId, string> = {
  "mlb-inning": "MLB inning-by-inning (run expectancy + bullpen fatigue)",
  "nba-possession": "NBA possession-by-possession (pace + fouls)",
  "wnba-possession": "WNBA possession-by-possession (pace + fouls)",
  "nfl-drive": "NFL drive-by-drive (play calling + clock)",
  "nhl-shift": "NHL shift-by-shift (goalie performance)",
  "soccer-xg": "Soccer xG + possession model",
  "tennis-point": "Tennis point → game → set → match",
  "ufc-round": "UFC/MMA strike/takedown/sub round model",
  "generic-team": "Generic team scoring model",
};
