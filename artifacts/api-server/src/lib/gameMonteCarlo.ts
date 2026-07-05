// Monte Carlo game-outcome simulator — projects team scores and win probability
// from real recent scoring form (pts for/against, venue splits, weather).

import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";

export type GameSimTeamInput = {
  ptsFor: number | null;
  ptsAgainst: number | null;
  recentScores?: number[];
};

/** Line-aware cover query — same shape the mobile shared scorer builds. */
export type GameCoverQuery = {
  id: string;
  kind: "ml" | "spread" | "total";
  teamSide?: "home" | "away";
  line?: number;
  totalSide?: "over" | "under";
};

export type GameSimInput = {
  sport: string;
  home: GameSimTeamInput;
  away: GameSimTeamInput;
  weatherImpact?: number | null;
  simulations?: number;
  /** Optional pick-specific cover rates computed during the same MC draw. */
  coverQueries?: GameCoverQuery[];
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
  /** Hit probability (0–1) per coverQueries[].id when queries were supplied. */
  coverHitRates?: Record<string, number>;
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

export function coverQueryHits(
  q: GameCoverQuery,
  homeScore: number,
  awayScore: number,
): boolean {
  const total = homeScore + awayScore;
  if (q.kind === "ml") {
    if (q.teamSide === "home") return homeScore > awayScore;
    if (q.teamSide === "away") return awayScore > homeScore;
    return false;
  }
  if (q.kind === "spread") {
    const line = q.line ?? 0;
    if (q.teamSide === "home") return homeScore + line > awayScore;
    if (q.teamSide === "away") return awayScore + line > homeScore;
    return false;
  }
  if (q.kind === "total") {
    const line = q.line ?? 0;
    if (q.totalSide === "over") return total > line;
    if (q.totalSide === "under") return total < line;
    return false;
  }
  return false;
}

export function runGameMonteCarlo(input: GameSimInput): GameSimResult | null {
  const n = input.simulations ?? DEFAULT_SIMULATIONS;
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
  const coverQueries = input.coverQueries ?? [];
  const coverHits: Record<string, number> = {};
  for (const q of coverQueries) coverHits[q.id] = 0;

  for (let i = 0; i < n; i++) {
    const hs = Math.max(0, normalSample(hMean, homeStd));
    const as = Math.max(0, normalSample(aMean, awayStd));
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
    for (const q of coverQueries) {
      if (coverQueryHits(q, hs, as)) coverHits[q.id] = (coverHits[q.id] ?? 0) + 1;
    }
  }

  const winner = winCounts.home >= winCounts.away ? "home" : "away";
  const winnerPct = (winner === "home" ? homeWins : awayWins) / n;

  let confidence = 50;
  if ((input.home.recentScores?.length ?? 0) >= 5) confidence += 10;
  if ((input.away.recentScores?.length ?? 0) >= 5) confidence += 10;
  confidence += Math.abs(homeWins / n - 0.5) * 50;

  let coverHitRates: Record<string, number> | undefined;
  if (coverQueries.length > 0) {
    coverHitRates = {};
    for (const q of coverQueries) {
      coverHitRates[q.id] = round3((coverHits[q.id] ?? 0) / n);
    }
  }

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
  };
}
