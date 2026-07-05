// Monte Carlo game-outcome simulator — projects team scores and win probability
// from real recent scoring form (pts for/against, venue splits, weather).

import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";

export type GameSimTeamInput = {
  ptsFor: number | null;
  ptsAgainst: number | null;
  recentScores?: number[];
};

/** In-progress game state for live-adjusted simulations. */
export type LiveGameState = {
  homeScore: number;
  awayScore: number;
  /** Inning/quarter/period number (1-based). */
  period: number;
  /** MLB inning half; omit for other sports. */
  inningHalf?: "top" | "bottom" | null;
  /** Regulation length (9 MLB, 4 NBA quarters, 3 NHL periods, etc.). */
  regulationPeriods?: number;
};

export type GameSimInput = {
  sport: string;
  home: GameSimTeamInput;
  away: GameSimTeamInput;
  weatherImpact?: number | null;
  simulations?: number;
  live?: LiveGameState | null;
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
  liveAdjusted?: boolean;
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

/** Remaining offensive half-innings per team in MLB regulation. */
export function mlbRemainingHalfInnings(
  inning: number,
  half: "top" | "bottom",
  regulationInnings = 9,
): { home: number; away: number } {
  const inn = clamp(inning, 1, regulationInnings);
  if (half === "top") {
    return { away: regulationInnings - inn + 1, home: regulationInnings - inn + 1 };
  }
  return { away: regulationInnings - inn, home: regulationInnings - inn + 1 };
}

function regulationPeriodsForSport(sport: string): number {
  if (sport === "mlb") return 9;
  if (sport === "nba" || sport === "wnba") return 4;
  if (sport === "nhl") return 3;
  return 4;
}

/** Fraction of regulation scoring still to play (0–1). */
function fractionScoringRemaining(sport: string, period: number, regulation: number): number {
  const p = clamp(period, 1, regulation);
  // Mid-period estimate: half the current period remains plus all later periods.
  return clamp((regulation - p + 0.5) / regulation, 0.05, 1);
}

function sampleRemainingRuns(meanPerGame: number, halves: number, stdScale: number): number {
  const perHalf = meanPerGame / (meanPerGame >= 6 ? 18 : 8);
  const std = Math.max(perHalf * stdScale, 0.35);
  let total = 0;
  for (let i = 0; i < halves; i++) {
    total += Math.max(0, normalSample(perHalf, std));
  }
  return total;
}

function simulateFinalScores(
  input: GameSimInput,
  hMean: number,
  aMean: number,
  homeStd: number,
  awayStd: number,
): { home: number; away: number } {
  const live = input.live;
  if (
    live &&
    Number.isFinite(live.homeScore) &&
    Number.isFinite(live.awayScore) &&
    live.period > 0
  ) {
    if (input.sport === "mlb") {
      const half = live.inningHalf === "bottom" ? "bottom" : "top";
      const rem = mlbRemainingHalfInnings(
        live.period,
        half,
        live.regulationPeriods ?? 9,
      );
      const stdScale = homeStd / Math.max(hMean, 0.8);
      return {
        home: live.homeScore + sampleRemainingRuns(hMean, rem.home, stdScale),
        away: live.awayScore + sampleRemainingRuns(aMean, rem.away, stdScale),
      };
    }
    const reg = live.regulationPeriods ?? regulationPeriodsForSport(input.sport);
    const frac = fractionScoringRemaining(input.sport, live.period, reg);
    return {
      home: live.homeScore + Math.max(0, normalSample(hMean * frac, homeStd * frac)),
      away: live.awayScore + Math.max(0, normalSample(aMean * frac, awayStd * frac)),
    };
  }
  return {
    home: Math.max(0, normalSample(hMean, homeStd)),
    away: Math.max(0, normalSample(aMean, awayStd)),
  };
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

  for (let i = 0; i < n; i++) {
    const { home: hs, away: as } = simulateFinalScores(input, hMean, aMean, homeStd, awayStd);
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
  if (input.live) confidence += 15;

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
    ...(input.live ? { liveAdjusted: true } : {}),
  };
}
