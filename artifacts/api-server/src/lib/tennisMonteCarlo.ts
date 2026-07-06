// Tennis match Monte Carlo — projects match-winner probability and total games
// from REAL ESPN ranking + recent-form data (not team scoring logs).

import { buildTennisMatchup, type TennisMatchup, type TennisPlayer } from "./tennis.js";
import {
  deriveCoverHitRates,
  type GameCoverQuery,
  type GameSimOutcomes,
  type GameSimResult,
} from "./gameMonteCarlo.js";
import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function rankStrength(rank: number | null): number {
  if (rank == null || rank <= 0 || !Number.isFinite(rank)) return 0.5;
  return 1 / (1 + rank * 0.07);
}

function formStrength(p: TennisPlayer): number {
  const fs = p.formSummary;
  if (!fs) return 0.5;
  const t = fs.wins + fs.losses;
  if (t <= 0) return 0.5;
  return fs.wins / t;
}

function avgGamesFromForm(p: TennisPlayer): number | null {
  const vals: number[] = [];
  for (const r of p.recentForm) {
    if (!r.score) continue;
    const parts = r.score.split(/\s+/).filter(Boolean);
    let games = 0;
    for (const set of parts) {
      const [a, b] = set.split("-").map((x) => parseInt(x, 10));
      if (Number.isFinite(a) && Number.isFinite(b)) games += a + b;
    }
    if (games > 0) vals.push(games);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Home win probability from real ranking, form, and H2H only. */
export function homeWinProbFromMatchup(m: TennisMatchup): number {
  let home = 0;
  let away = 0;
  let w = 0;

  const hr = rankStrength(m.home.rank);
  const ar = rankStrength(m.away.rank);
  if (m.home.rank != null || m.away.rank != null) {
    home += hr * 2.2;
    away += ar * 2.2;
    w += 2.2;
  }

  const hf = formStrength(m.home);
  const af = formStrength(m.away);
  if (m.home.formSummary || m.away.formSummary) {
    home += hf * 1.4;
    away += af * 1.4;
    w += 1.4;
  }

  if (m.h2h && m.h2h.meetings.length > 0) {
    const total = m.h2h.homeWins + m.h2h.awayWins;
    if (total > 0) {
      home += (m.h2h.homeWins / total) * 1.0;
      away += (m.h2h.awayWins / total) * 1.0;
      w += 1.0;
    }
  }

  if (w <= 0) return 0.5;
  const raw = home / (home + away);
  return clamp(raw, 0.12, 0.88);
}

function normalSample(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

export type TennisSimInput = {
  away: string;
  home: string;
  simulations?: number;
  coverQueries?: GameCoverQuery[];
  retainOutcomes?: boolean;
};

export async function runTennisMonteCarlo(input: TennisSimInput): Promise<GameSimResult | null> {
  const matchup = await buildTennisMatchup(input.away, input.home);
  const n = input.simulations ?? DEFAULT_SIMULATIONS;
  const retainOutcomes = input.retainOutcomes !== false;
  const homeWinProb = homeWinProbFromMatchup(matchup);

  const homeAvg = avgGamesFromForm(matchup.home);
  const awayAvg = avgGamesFromForm(matchup.away);
  const totalMean =
    homeAvg != null && awayAvg != null
      ? (homeAvg + awayAvg) / 2
      : homeAvg ?? awayAvg ?? 22;
  const totalStd = Math.max(3.5, totalMean * 0.12);

  let homeWins = 0;
  let awayWins = 0;
  let homeGamesTotal = 0;
  let awayGamesTotal = 0;
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  for (let i = 0; i < n; i++) {
    const homeWinsMatch = Math.random() < homeWinProb;
    let totalGames = Math.round(clamp(normalSample(totalMean, totalStd), 14, 40));
    if (totalGames % 2 === 0) totalGames += 1;
    const margin = 1 + Math.floor(Math.random() * 4);
    let hGames: number;
    let aGames: number;
    if (homeWinsMatch) {
      hGames = Math.ceil(totalGames / 2) + Math.floor(margin / 2);
      aGames = totalGames - hGames;
      if (aGames >= hGames) {
        hGames = aGames + 1;
      }
      homeWins += 1;
    } else {
      aGames = Math.ceil(totalGames / 2) + Math.floor(margin / 2);
      hGames = totalGames - aGames;
      if (hGames >= aGames) {
        aGames = hGames + 1;
      }
      awayWins += 1;
    }
    homeGamesTotal += hGames;
    awayGamesTotal += aGames;
    homeScores.push(round2(hGames));
    awayScores.push(round2(aGames));
  }

  const winner = homeWins >= awayWins ? "home" : "away";
  const winnerPct = (winner === "home" ? homeWins : awayWins) / n;

  let confidence = 48;
  if (matchup.home.rank != null && matchup.away.rank != null) confidence += 12;
  if (matchup.home.formSummary && matchup.away.formSummary) confidence += 10;
  if (matchup.h2h?.meetings.length) confidence += 8;
  confidence = clamp(confidence, 40, 88);

  const outcomes: GameSimOutcomes = { homeScores, awayScores };
  const coverQueries = input.coverQueries ?? [];
  const coverHitRates =
    coverQueries.length > 0 ? deriveCoverHitRates(outcomes, coverQueries) : undefined;

  const result: GameSimResult = {
    simulations: n,
    homeWinProbability: round3(homeWins / n),
    awayWinProbability: round3(awayWins / n),
    tieProbability: 0,
    homeProjectedScore: round2(homeGamesTotal / n),
    awayProjectedScore: round2(awayGamesTotal / n),
    mostLikelyWinner: winner,
    mostLikelyWinnerPct: round3(winnerPct),
    confidenceScore: Math.round(confidence),
    coverHitRates,
  };

  if (retainOutcomes) result.outcomes = outcomes;
  return result;
}
