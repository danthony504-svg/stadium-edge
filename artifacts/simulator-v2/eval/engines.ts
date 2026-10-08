/**
 * Prediction engines for historical validation (shadow/offline only).
 */

import {
  buildJointFootballTensor,
  validateScenarioConsistency,
  type SimV2ScenarioTensor,
} from "../src/index.js";
import { createSeededRng } from "../src/seed/mulberry32.js";
import type {
  EligibleGame,
  EngineName,
  EnginePrediction,
  EvalMarketSpec,
  FootballSport,
  HistoricalGame,
} from "./types.js";
import { actualPeriodScores } from "./walkForward.js";

const EPS = 1e-9;

function normalSample(rng: () => number, mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function teamMean(forPts: number, oppAgainst: number): number {
  return (forPts + oppAgainst) / 2;
}

function teamStd(recent: number[], mean: number): number {
  if (recent.length >= 2) {
    const v =
      recent.reduce((a, x) => a + (x - avg(recent)) ** 2, 0) / Math.max(1, recent.length - 1);
    return Math.max(Math.sqrt(v), mean * 0.12, 0.8);
  }
  return Math.max(mean * 0.22, 0.8);
}

/** V1-style: independent FG normals + frac×noise period overwrite (not conserved). */
export function simulateV1FracTensor(
  game: EligibleGame,
  seed: string,
  nDraws: number,
): {
  homeFg: Float64Array;
  awayFg: Float64Array;
  homeByPeriod: Record<string, Float64Array>;
  awayByPeriod: Record<string, Float64Array>;
  periodSumBreaks: number;
} {
  const { next } = createSeededRng(seed);
  const hMean = teamMean(game.homeForm.ptsFor, game.awayForm.ptsAgainst);
  const aMean = teamMean(game.awayForm.ptsFor, game.homeForm.ptsAgainst);
  const hStd = teamStd(game.homeForm.recentFgScores, hMean);
  const aStd = teamStd(game.awayForm.recentFgScores, aMean);

  const homeFg = new Float64Array(nDraws);
  const awayFg = new Float64Array(nDraws);
  const periods = ["q1", "q2", "q3", "q4", "h1", "h2"] as const;
  const frac: Record<(typeof periods)[number], number> = {
    q1: 0.26,
    q2: 0.24,
    q3: 0.26,
    q4: 0.24,
    h1: 0.5,
    h2: 0.5,
  };
  const homeByPeriod: Record<string, Float64Array> = {};
  const awayByPeriod: Record<string, Float64Array> = {};
  for (const p of periods) {
    homeByPeriod[p] = new Float64Array(nDraws);
    awayByPeriod[p] = new Float64Array(nDraws);
  }

  let periodSumBreaks = 0;
  for (let i = 0; i < nDraws; i++) {
    const h = Math.max(0, normalSample(next, hMean, hStd));
    const a = Math.max(0, normalSample(next, aMean, aStd));
    homeFg[i] = h;
    awayFg[i] = a;
    for (const p of periods) {
      const noiseH = 1 + (next() - 0.5) * 0.14;
      const noiseA = 1 + (next() - 0.5) * 0.14;
      homeByPeriod[p]![i] = Math.max(0, Math.round(h * frac[p] * noiseH * 100) / 100);
      awayByPeriod[p]![i] = Math.max(0, Math.round(a * frac[p] * noiseA * 100) / 100);
    }
    const hSum =
      homeByPeriod.q1![i] + homeByPeriod.q2![i] + homeByPeriod.q3![i] + homeByPeriod.q4![i];
    const aSum =
      awayByPeriod.q1![i] + awayByPeriod.q2![i] + awayByPeriod.q3![i] + awayByPeriod.q4![i];
    if (Math.abs(hSum - h) > 1e-6 || Math.abs(aSum - a) > 1e-6) periodSumBreaks += 1;
  }

  return { homeFg, awayFg, homeByPeriod, awayByPeriod, periodSumBreaks };
}

export function simulateV2Joint(
  game: EligibleGame,
  seed: string,
  nDraws: number,
): { tensor: SimV2ScenarioTensor; consistencyOk: boolean; breaks: number } {
  const tensor = buildJointFootballTensor({
    sport: game.game.sport,
    eventId: game.game.eventId,
    seed,
    nDraws,
    home: {
      teamId: game.homeForm.teamId,
      scoredByQuarter: game.homeForm.scoredByQuarter,
      allowedByQuarter: game.homeForm.allowedByQuarter,
      ptsFor: game.homeForm.ptsFor,
      ptsAgainst: game.homeForm.ptsAgainst,
      recentFgScores: game.homeForm.recentFgScores,
    },
    away: {
      teamId: game.awayForm.teamId,
      scoredByQuarter: game.awayForm.scoredByQuarter,
      allowedByQuarter: game.awayForm.allowedByQuarter,
      ptsFor: game.awayForm.ptsFor,
      ptsAgainst: game.awayForm.ptsAgainst,
      recentFgScores: game.awayForm.recentFgScores,
    },
    provenanceProviders: ["espn_historical_walkforward"],
  });
  const report = validateScenarioConsistency(tensor, {
    periodSumGroup: ["q1", "q2", "q3", "q4"],
    checkDerivedHalves: true,
  });
  let breaks = 0;
  if (!report.ok) {
    // Count draw-level breaks if present; otherwise treat as full reject.
    breaks = report.issues.some((i) => i.drawIndex != null) ? 1 : tensor.meta.nDraws;
  }
  return { tensor, consistencyOk: report.ok, breaks };
}

function periodArrays(
  source: {
    homeFg: Float64Array;
    awayFg: Float64Array;
    homeByPeriod: Record<string, Float64Array>;
    awayByPeriod: Record<string, Float64Array>;
  },
  period: EvalMarketSpec["period"],
): { home: Float64Array; away: Float64Array } {
  if (period === "fg") return { home: source.homeFg, away: source.awayFg };
  return {
    home: source.homeByPeriod[period]!,
    away: source.awayByPeriod[period]!,
  };
}

function hitRate(
  home: Float64Array,
  away: Float64Array,
  spec: EvalMarketSpec,
): number {
  let hits = 0;
  const n = home.length;
  const line = spec.line ?? 0;
  for (let i = 0; i < n; i++) {
    const h = home[i]!;
    const a = away[i]!;
    let ok = false;
    switch (spec.kind) {
      case "ml_home":
        ok = h > a;
        break;
      case "spread_home":
        ok = h + line > a;
        break;
      case "total_over":
        ok = h + a > line;
        break;
      case "team_total_home_over":
        ok = h > line;
        break;
      case "team_total_away_over":
        ok = a > line;
        break;
    }
    if (ok) hits += 1;
  }
  return hits / n;
}

function meanPair(home: Float64Array, away: Float64Array): { home: number; away: number } {
  let h = 0;
  let a = 0;
  for (let i = 0; i < home.length; i++) {
    h += home[i]!;
    a += away[i]!;
  }
  return { home: h / home.length, away: a / away.length };
}

type DrawSource = {
  homeFg: Float64Array;
  awayFg: Float64Array;
  homeByPeriod: Record<string, Float64Array>;
  awayByPeriod: Record<string, Float64Array>;
};

function predictFromDraws(
  engine: EngineName,
  source: DrawSource,
  spec: EvalMarketSpec,
  meta?: { consistencyOk?: boolean; consistencyBreaks?: number },
): EnginePrediction {
  const { home, away } = periodArrays(source, spec.period);
  const means = meanPair(home, away);
  return {
    engine,
    p: hitRate(home, away, spec),
    predHome: means.home,
    predAway: means.away,
    predTotal: means.home + means.away,
    consistencyOk: meta?.consistencyOk,
    consistencyBreaks: meta?.consistencyBreaks,
  };
}

export function predictV2(
  game: EligibleGame,
  spec: EvalMarketSpec,
  nDraws: number,
): EnginePrediction {
  const { tensor, consistencyOk, breaks } = simulateV2Joint(
    game,
    `v2:${game.game.eventId}`,
    nDraws,
  );
  return predictFromDraws(
    "v2_joint",
    {
      homeFg: tensor.team.homeFg,
      awayFg: tensor.team.awayFg,
      homeByPeriod: tensor.team.homeByPeriod as Record<string, Float64Array>,
      awayByPeriod: tensor.team.awayByPeriod as Record<string, Float64Array>,
    },
    spec,
    { consistencyOk, consistencyBreaks: breaks },
  );
}

export function predictV1(
  game: EligibleGame,
  spec: EvalMarketSpec,
  nDraws: number,
): EnginePrediction {
  const sim = simulateV1FracTensor(game, `v1:${game.game.eventId}`, nDraws);
  return predictFromDraws("v1_frac", sim, spec, {
    consistencyOk: sim.periodSumBreaks === 0,
    consistencyBreaks: sim.periodSumBreaks,
  });
}

/** One V2 + V1 simulation per game; settle every market from the same draws. */
export function predictAllMarketsForGame(
  game: EligibleGame,
  markets: EvalMarketSpec[],
  nDraws: number,
): {
  v2ByMarket: Map<string, EnginePrediction>;
  v1ByMarket: Map<string, EnginePrediction>;
  scoreMeans: ScoreMeans[];
  v2ConsistencyOk: boolean;
  v1BreakRate: number;
} {
  const v2 = simulateV2Joint(game, `v2:${game.game.eventId}`, nDraws);
  const v1 = simulateV1FracTensor(game, `v1:${game.game.eventId}`, nDraws);
  const v2Source: DrawSource = {
    homeFg: v2.tensor.team.homeFg,
    awayFg: v2.tensor.team.awayFg,
    homeByPeriod: v2.tensor.team.homeByPeriod as Record<string, Float64Array>,
    awayByPeriod: v2.tensor.team.awayByPeriod as Record<string, Float64Array>,
  };
  const v2ByMarket = new Map<string, EnginePrediction>();
  const v1ByMarket = new Map<string, EnginePrediction>();
  for (const spec of markets) {
    v2ByMarket.set(
      spec.id,
      predictFromDraws("v2_joint", v2Source, spec, {
        consistencyOk: v2.consistencyOk,
        consistencyBreaks: v2.breaks,
      }),
    );
    v1ByMarket.set(
      spec.id,
      predictFromDraws("v1_frac", v1, spec, {
        consistencyOk: v1.periodSumBreaks === 0,
        consistencyBreaks: v1.periodSumBreaks,
      }),
    );
  }

  const periods = ["fg", "q1", "q2", "q3", "q4", "h1", "h2"] as const;
  const pack = (engine: EngineName, source: DrawSource): ScoreMeans => {
    const byPeriod: ScoreMeans["byPeriod"] = {};
    for (const p of periods) {
      const { home, away } = periodArrays(source, p);
      const m = meanPair(home, away);
      const actual = actualPeriodScores(game.game, p);
      byPeriod[p] = {
        predHome: m.home,
        predAway: m.away,
        actualHome: actual.home,
        actualAway: actual.away,
      };
    }
    return { engine, byPeriod };
  };

  return {
    v2ByMarket,
    v1ByMarket,
    scoreMeans: [pack("v2_joint", v2Source), pack("v1_frac", v1)],
    v2ConsistencyOk: v2.consistencyOk,
    v1BreakRate: v1.periodSumBreaks / nDraws,
  };
}

/** Empirical frequency baseline from prior eligible games (no leakage). */
export function predictBaselineHist(
  priorOutcomes: Array<0 | 1>,
  fallback = 0.5,
): EnginePrediction {
  if (!priorOutcomes.length) {
    return { engine: "baseline_hist", p: fallback };
  }
  const p = priorOutcomes.reduce<number>((s, y) => s + y, 0) / priorOutcomes.length;
  return { engine: "baseline_hist", p: Math.min(1 - EPS, Math.max(EPS, p)) };
}

export function predictBaselineCoin(): EnginePrediction {
  return { engine: "baseline_coin", p: 0.5 };
}

export function actualMarketHit(game: HistoricalGame, spec: EvalMarketSpec): 0 | 1 {
  const { home, away } = actualPeriodScores(game, spec.period);
  const line = spec.line ?? 0;
  switch (spec.kind) {
    case "ml_home":
      return home > away ? 1 : 0;
    case "spread_home":
      return home + line > away ? 1 : 0;
    case "total_over":
      return home + away > line ? 1 : 0;
    case "team_total_home_over":
      return home > line ? 1 : 0;
    case "team_total_away_over":
      return away > line ? 1 : 0;
  }
}

export function buildMarketGrid(sport: FootballSport): EvalMarketSpec[] {
  const totals =
    sport === "nfl"
      ? [37.5, 41.5, 44.5, 48.5, 52.5]
      : [41.5, 48.5, 52.5, 58.5, 65.5];
  const spreads = [-3.5, -7.5, -10.5, -14.5, -17.5, 3.5];
  const teamTotals = sport === "nfl" ? [17.5, 20.5, 24.5, 28.5] : [20.5, 24.5, 28.5, 34.5];
  const out: EvalMarketSpec[] = [
    { id: "fg_ml_home", kind: "ml_home", family: "ml", period: "fg" },
    { id: "h1_ml_home", kind: "ml_home", family: "ml", period: "h1" },
    { id: "q2_ml_home", kind: "ml_home", family: "ml", period: "q2" },
  ];
  for (const line of spreads) {
    out.push({
      id: `fg_spr_home_${line}`,
      kind: "spread_home",
      family: "spread",
      period: "fg",
      line,
      extreme: Math.abs(line) >= 14,
    });
  }
  out.push({
    id: "q2_spr_home_3.5",
    kind: "spread_home",
    family: "spread",
    period: "q2",
    line: 3.5,
  });
  out.push({
    id: "h1_spr_home_-3.5",
    kind: "spread_home",
    family: "spread",
    period: "h1",
    line: -3.5,
  });
  for (const line of totals) {
    out.push({
      id: `fg_tot_over_${line}`,
      kind: "total_over",
      family: "total",
      period: "fg",
      line,
    });
  }
  out.push({
    id: "h1_tot_over_20.5",
    kind: "total_over",
    family: "total",
    period: "h1",
    line: sport === "nfl" ? 20.5 : 24.5,
  });
  for (const line of teamTotals) {
    out.push({
      id: `fg_tt_home_${line}`,
      kind: "team_total_home_over",
      family: "team_total",
      period: "fg",
      line,
      extreme: line >= 28.5,
    });
    out.push({
      id: `fg_tt_away_${line}`,
      kind: "team_total_away_over",
      family: "team_total",
      period: "fg",
      line,
      extreme: line >= 28.5,
    });
  }
  return out;
}

export type ScoreMeans = {
  engine: EngineName;
  byPeriod: Record<
    string,
    { predHome: number; predAway: number; actualHome: number; actualAway: number }
  >;
};
