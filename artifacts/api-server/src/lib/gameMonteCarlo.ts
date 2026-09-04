// Monte Carlo game-outcome simulator — projects team scores and win probability
// from real recent scoring form (pts for/against, venue splits, weather).
// One 10k draw set powers every game-line market (ML, spread, alt spread, total).

import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";
import {
  periodScoresForDraw,
  raceToHits,
  type SimPeriodScope,
  sportSupportsPeriod,
} from "./gamePeriodMonteCarlo.js";

export type { SimPeriodScope };

export type GameSimTeamInput = {
  ptsFor: number | null;
  ptsAgainst: number | null;
  recentScores?: number[];
};

/** Line-aware cover query — same shape the mobile shared scorer builds. */
export type GameCoverQuery = {
  id: string;
  kind: "ml" | "spread" | "total" | "teamTotal" | "raceTo";
  teamSide?: "home" | "away";
  line?: number;
  totalSide?: "over" | "under";
  /** Period scope — fg (default) uses full-game scores; q1/h1/f5/etc. use period draws. */
  period?: SimPeriodScope;
  /** Race-to target (e.g. 20 for race-to-20). */
  raceTarget?: number;
};

export type GameSimOutcomes = {
  homeScores: number[];
  awayScores: number[];
};

export type GameSimInput = {
  sport: string;
  home: GameSimTeamInput;
  away: GameSimTeamInput;
  weatherImpact?: number | null;
  simulations?: number;
  /** Pick-specific lines scored against the SAME draw set. */
  coverQueries?: GameCoverQuery[];
  /** When true (default), return every draw for client-side market derivation. */
  retainOutcomes?: boolean;
};

export type GameSimResult = {
  simulations: number;
  homeWinProbability: number;
  awayWinProbability: number;
  tieProbability: number;
  homeProjectedScore: number;
  awayProjectedScore: number;
  mostLikelyWinner: "home" | "away";
  mostLikelyWinnerPct: number;
  confidenceScore: number;
  /** Hit probability (0–1) per coverQueries[].id. */
  coverHitRates?: Record<string, number>;
  /** Full draw store — one run powers all game-line markets. */
  outcomes?: GameSimOutcomes;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function normalSample(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

function teamMean(forPts: number | null, oppAgainst: number | null, fallback: number): number {
  const parts = [forPts, oppAgainst].filter((v): v is number => v != null && Number.isFinite(v));
  if (!parts.length) return fallback;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export function coverQueryResult(
  q: GameCoverQuery,
  homeScore: number,
  awayScore: number,
  sport = "nba",
): boolean | null {
  if (q.kind === "raceTo") {
    const target = q.raceTarget ?? 0;
    const side = q.teamSide ?? "home";
    if (target <= 0) return false;
    return raceToHits(target, side, homeScore, awayScore);
  }

  const period: SimPeriodScope = q.period ?? "fg";
  const scoped =
    period === "fg" || !sportSupportsPeriod(sport, period)
      ? { home: homeScore, away: awayScore }
      : periodScoresForDraw(sport, period, homeScore, awayScore);
  const hs = scoped.home;
  const as = scoped.away;
  const total = hs + as;

  if (q.kind === "ml") {
    if (hs === as) return null;
    if (q.teamSide === "home") return hs > as;
    if (q.teamSide === "away") return as > hs;
    return false;
  }
  if (q.kind === "spread") {
    const line = q.line ?? 0;
    if (q.teamSide === "home") {
      const margin = hs + line - as;
      return margin === 0 ? null : margin > 0;
    }
    if (q.teamSide === "away") {
      const margin = as + line - hs;
      return margin === 0 ? null : margin > 0;
    }
    return false;
  }
  if (q.kind === "total") {
    const line = q.line ?? 0;
    if (total === line) return null;
    if (q.totalSide === "over") return total > line;
    if (q.totalSide === "under") return total < line;
    return false;
  }
  if (q.kind === "teamTotal") {
    const line = q.line ?? 0;
    const score = q.teamSide === "home" ? hs : as;
    if (score === line) return null;
    if (q.totalSide === "over") return score > line;
    if (q.totalSide === "under") return score < line;
    return false;
  }
  return false;
}

/** Score arbitrary lines against a saved draw set (no re-simulation). */
export function deriveCoverHitRates(
  outcomes: GameSimOutcomes,
  queries: GameCoverQuery[],
  sport = "nba",
): Record<string, number> {
  const n = outcomes.homeScores.length;
  if (!n || n !== outcomes.awayScores.length) return {};
  const rates: Record<string, number> = {};
  for (const q of queries) {
    let hits = 0;
    let decisions = 0;
    for (let i = 0; i < n; i++) {
      const result = coverQueryResult(q, outcomes.homeScores[i]!, outcomes.awayScores[i]!, sport);
      if (result == null) continue;
      decisions += 1;
      if (result) hits += 1;
    }
    if (decisions > 0) rates[q.id] = round3(hits / decisions);
  }
  return rates;
}

export function runGameMonteCarlo(input: GameSimInput): GameSimResult | null {
  const n = input.simulations ?? DEFAULT_SIMULATIONS;
  const retainOutcomes = input.retainOutcomes !== false;
  const homeMean = teamMean(input.home.ptsFor, input.away.ptsAgainst, 4.5);
  const awayMean = teamMean(input.away.ptsFor, input.home.ptsAgainst, 4.5);

  if (!Number.isFinite(homeMean) || !Number.isFinite(awayMean)) return null;

  let hMean = homeMean;
  let aMean = awayMean;
  if (input.weatherImpact != null && input.sport === "mlb") {
    const w = clamp(input.weatherImpact, -1, 1);
    hMean *= 1 + w * 0.06;
    aMean *= 1 + w * 0.06;
  }

  const homeStd = Math.max(
    input.home.recentScores?.length
      ? Math.sqrt(
          input.home.recentScores.reduce((a, x) => a + (x - avg(input.home.recentScores!)) ** 2, 0) /
            Math.max(1, input.home.recentScores.length - 1),
        )
      : hMean * 0.22,
    hMean * 0.12,
    0.8,
  );
  const awayStd = Math.max(
    input.away.recentScores?.length
      ? Math.sqrt(
          input.away.recentScores.reduce((a, x) => a + (x - avg(input.away.recentScores!)) ** 2, 0) /
            Math.max(1, input.away.recentScores.length - 1),
        )
      : aMean * 0.22,
    aMean * 0.12,
    0.8,
  );

  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;
  let homeTotal = 0;
  let awayTotal = 0;
  const winCounts = { home: 0, away: 0 };
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  const coverQueries = input.coverQueries ?? [];

  for (let i = 0; i < n; i++) {
    const hs = Math.max(0, normalSample(hMean, homeStd));
    const as = Math.max(0, normalSample(aMean, awayStd));
    homeScores.push(round2(hs));
    awayScores.push(round2(as));
    homeTotal += hs;
    awayTotal += as;
    if (Math.abs(hs - as) < 0.01) ties += 1;
    else if (hs > as) {
      homeWins += 1;
      winCounts.home += 1;
    } else {
      awayWins += 1;
      winCounts.away += 1;
    }
  }

  const winner = winCounts.home >= winCounts.away ? "home" : "away";
  const winnerPct = (winner === "home" ? homeWins : awayWins) / n;

  let confidence = 50;
  if ((input.home.recentScores?.length ?? 0) >= 5) confidence += 10;
  if ((input.away.recentScores?.length ?? 0) >= 5) confidence += 10;
  confidence += Math.abs(homeWins / n - 0.5) * 50;

  const outcomes: GameSimOutcomes = { homeScores, awayScores };
  const coverHitRates =
    coverQueries.length > 0 ? deriveCoverHitRates(outcomes, coverQueries, input.sport) : undefined;

  return {
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
    ...(retainOutcomes ? { outcomes } : {}),
  };
}
