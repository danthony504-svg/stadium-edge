// UFC fight Monte Carlo — 10,000 binary outcome draws from REAL ESPN career
// signals (record, rates, reach, age, data lean). Method-of-victory rates are
// derived only from documented win-method counts when present. Never fabricates
// fight history, round data, or prop lines UFC does not carry.

import {
  computeFightLean,
  normFighter,
  type FightComparison,
  type FightLean,
  type Fighter,
  type FighterMethods,
} from "./ufc.js";
import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type FightMethodRates = {
  ko: number;
  tko: number;
  sub: number;
  decision: number;
};

export type FightSimResult = {
  simulations: number;
  awayWinProbability: number;
  homeWinProbability: number;
  mostLikelyWinner: "away" | "home";
  mostLikelyWinnerPct: number;
  confidenceScore: number;
  /** Share of sims where the winner finished by each method (0–1), or null. */
  methodRates: {
    away: FightMethodRates;
    home: FightMethodRates;
  } | null;
  /** Model round-win rates (3-round bout) from finish/decision mix — not fight logs. */
  roundWinPct: {
    away: { r1: number; r2: number; r3: number };
    home: { r1: number; r2: number; r3: number };
  } | null;
};

function methodDistribution(methods: FighterMethods, wins: number): FightMethodRates | null {
  const ko = methods.koWins ?? 0;
  const tko = methods.tkoWins ?? 0;
  const sub = methods.subWins ?? 0;
  const dec = methods.decisionWins;
  const known = ko + tko + sub + (dec ?? 0);
  if (wins <= 0 || known <= 0) return null;
  const total = dec != null ? known : ko + tko + sub;
  if (total <= 0) return null;
  const dShare = dec != null ? dec / total : Math.max(0, 1 - (ko + tko + sub) / total);
  return {
    ko: ko / total,
    tko: tko / total,
    sub: sub / total,
    decision: dShare,
  };
}

function sampleMethod(dist: FightMethodRates): keyof FightMethodRates {
  const r = Math.random();
  let acc = dist.ko;
  if (r < acc) return "ko";
  acc += dist.tko;
  if (r < acc) return "tko";
  acc += dist.sub;
  if (r < acc) return "sub";
  return "decision";
}

/** Earlier finishes weighted toward R1/R2 from career method rates (model, not logs). */
function sampleFinishRound(method: keyof FightMethodRates): number {
  const r = Math.random();
  if (method === "decision") return 3;
  if (method === "sub") return r < 0.35 ? 1 : r < 0.7 ? 2 : 3;
  return r < 0.42 ? 1 : r < 0.75 ? 2 : 3;
}

function assignRoundWins(
  awayWon: boolean,
  isFinish: boolean,
  finishRound: number,
  awayRounds: { r1: number; r2: number; r3: number },
  homeRounds: { r1: number; r2: number; r3: number },
) {
  if (!isFinish) {
    if (awayWon) {
      awayRounds.r1 += 1;
      awayRounds.r2 += 1;
      awayRounds.r3 += 1;
    } else {
      homeRounds.r1 += 1;
      homeRounds.r2 += 1;
      homeRounds.r3 += 1;
    }
    return;
  }
  const winnerRounds = awayWon ? awayRounds : homeRounds;
  const loserRounds = awayWon ? homeRounds : awayRounds;
  if (finishRound >= 1) {
    if (finishRound === 1) {
      loserRounds.r1 += 0.15;
      winnerRounds.r1 += 1;
    } else if (finishRound === 2) {
      loserRounds.r1 += 0.55;
      winnerRounds.r1 += 0.45;
      winnerRounds.r2 += 1;
    } else {
      loserRounds.r1 += 0.45;
      loserRounds.r2 += 0.45;
      winnerRounds.r1 += 0.55;
      winnerRounds.r2 += 0.55;
      winnerRounds.r3 += 1;
    }
  }
}

export type FightSimInput = {
  away: Fighter;
  home: Fighter;
  lean: FightLean | null;
  comparison?: FightComparison;
};

/** Away win probability from grounded fight signals only. */
export function awayWinProbFromFight(input: FightSimInput): number {
  const { away, home } = input;
  let awayScore = 0;
  let homeScore = 0;
  let weight = 0;

  if (away.record && home.record) {
    awayScore += away.record.winPct * 0.04;
    homeScore += home.record.winPct * 0.04;
    weight += 0.04 * 100;
  }

  const lean = input.lean ?? computeFightLean(away, home);
  if (lean?.side && lean.edge >= 0.3) {
    const favAway =
      normFighter(lean.side) === normFighter(away.resolvedName || away.name);
    const bump = clamp(lean.edge * 0.035, 0.04, 0.22);
    if (favAway) {
      awayScore += 0.5 + bump;
      homeScore += 0.5 - bump;
    } else {
      homeScore += 0.5 + bump;
      awayScore += 0.5 - bump;
    }
    weight += 1;
  }

  if (away.profile.reachIn != null && home.profile.reachIn != null) {
    const reachDiff = away.profile.reachIn - home.profile.reachIn;
    if (Math.abs(reachDiff) >= 2) {
      const bump = clamp(Math.abs(reachDiff) * 0.008, 0.02, 0.08);
      if (reachDiff > 0) {
        awayScore += bump;
        homeScore -= bump * 0.5;
      } else {
        homeScore += bump;
        awayScore -= bump * 0.5;
      }
      weight += 0.5;
    }
  }

  if (away.profile.age != null && home.profile.age != null) {
    const diff = home.profile.age - away.profile.age;
    if (Math.abs(diff) >= 3) {
      const bump = clamp(Math.abs(diff) * 0.004, 0.01, 0.06);
      if (diff > 0) {
        awayScore += bump;
      } else {
        homeScore += bump;
      }
      weight += 0.35;
    }
  }

  factorRates(away, home, (a, h, w) => {
    awayScore += a * w;
    homeScore += h * w;
    weight += w;
  });

  if (weight <= 0) return 0.5;
  const raw = awayScore / (awayScore + homeScore);
  return clamp(raw, 0.12, 0.88);
}

function factorRates(
  away: Fighter,
  home: Fighter,
  add: (awayVal: number, homeVal: number, weight: number) => void,
) {
  const pairs: Array<[number | null, number | null, number]> = [
    [away.stats.strikeLPM, home.stats.strikeLPM, 0.18],
    [away.stats.strikeAccuracy, home.stats.strikeAccuracy, 0.14],
    [away.stats.takedownAvg, home.stats.takedownAvg, 0.12],
    [away.stats.finishPct, home.stats.finishPct, 0.1],
  ];
  for (const [a, h, w] of pairs) {
    if (a == null || h == null) continue;
    add(a, h, w);
  }
}

export function runFightMonteCarlo(
  input: FightSimInput,
  simulations: number = DEFAULT_SIMULATIONS,
): FightSimResult {
  const n = simulations > 0 ? simulations : DEFAULT_SIMULATIONS;
  const { away, home } = input;
  const awayProb = awayWinProbFromFight(input);
  const awayDist =
    away.record && away.methods
      ? methodDistribution(away.methods, away.record.wins)
      : null;
  const homeDist =
    home.record && home.methods
      ? methodDistribution(home.methods, home.record.wins)
      : null;
  const trackMethods = awayDist != null || homeDist != null;

  let awayWins = 0;
  let homeWins = 0;
  const awayMethods: FightMethodRates = { ko: 0, tko: 0, sub: 0, decision: 0 };
  const homeMethods: FightMethodRates = { ko: 0, tko: 0, sub: 0, decision: 0 };
  const awayRounds = { r1: 0, r2: 0, r3: 0 };
  const homeRounds = { r1: 0, r2: 0, r3: 0 };

  for (let i = 0; i < n; i++) {
    const awayWinsFight = Math.random() < awayProb;
    let finishRound = 3;
    let isFinish = false;

    if (awayWinsFight) {
      awayWins += 1;
      if (trackMethods && awayDist) {
        const m = sampleMethod(awayDist);
        awayMethods[m] += 1;
        isFinish = m !== "decision";
        finishRound = isFinish ? sampleFinishRound(m) : 3;
      }
      assignRoundWins(true, isFinish, finishRound, awayRounds, homeRounds);
    } else {
      homeWins += 1;
      if (trackMethods && homeDist) {
        const m = sampleMethod(homeDist);
        homeMethods[m] += 1;
        isFinish = m !== "decision";
        finishRound = isFinish ? sampleFinishRound(m) : 3;
      }
      assignRoundWins(false, isFinish, finishRound, awayRounds, homeRounds);
    }
  }

  const winner = awayWins >= homeWins ? "away" : "home";
  const winnerPct = (winner === "away" ? awayWins : homeWins) / n;

  let confidence = 45;
  if (input.lean) confidence += clamp(input.lean.edge * 8, 0, 18);
  confidence += Math.abs(awayWins / n - 0.5) * 55;
  if (away.record && home.record) confidence += 8;
  if (away.stats.strikeLPM != null && home.stats.strikeLPM != null) confidence += 6;

  const normMethods = (m: FightMethodRates, wins: number): FightMethodRates => ({
    ko: wins > 0 ? round3(m.ko / wins) : 0,
    tko: wins > 0 ? round3(m.tko / wins) : 0,
    sub: wins > 0 ? round3(m.sub / wins) : 0,
    decision: wins > 0 ? round3(m.decision / wins) : 0,
  });

  const normRounds = (r: { r1: number; r2: number; r3: number }, total: number) => ({
    r1: total > 0 ? round3(r.r1 / total) : 0,
    r2: total > 0 ? round3(r.r2 / total) : 0,
    r3: total > 0 ? round3(r.r3 / total) : 0,
  });

  return {
    simulations: n,
    awayWinProbability: round3(awayWins / n),
    homeWinProbability: round3(homeWins / n),
    mostLikelyWinner: winner,
    mostLikelyWinnerPct: round3(winnerPct),
    confidenceScore: clamp(Math.round(confidence), 5, 95),
    methodRates: trackMethods
      ? {
          away: normMethods(awayMethods, awayWins),
          home: normMethods(homeMethods, homeWins),
        }
      : null,
    roundWinPct: trackMethods
      ? {
          away: normRounds(awayRounds, n),
          home: normRounds(homeRounds, n),
        }
      : null,
  };
}
