/**
 * Phase B calibration + V1 comparison diagnostics (shadow / offline only).
 */

import type { SimV2ScenarioTensor } from "../../schemas/scenarioTensor.js";
import type { SimV2Market } from "../../schemas/market.js";
import type { SimV2Odds } from "../../schemas/odds.js";
import { settleMarket } from "../../engine/settle.js";
import {
  brierScore,
  expectedCalibrationError,
  logLoss,
  reliabilityDiagram,
  type BinaryObservation,
  type ReliabilityBin,
} from "../../metrics/calibration.js";
import { createSeededRng } from "../../seed/mulberry32.js";
import { summarizeJointFootballTensor } from "./jointFootball.js";

export type HistoricalGameOutcome = {
  eventId: string;
  sport: "nfl" | "ncaaf";
  /** Actual final scores (home/away). */
  homeFg: number;
  awayFg: number;
  homeByPeriod?: Partial<Record<"q1" | "q2" | "q3" | "q4" | "h1" | "h2", number>>;
  awayByPeriod?: Partial<Record<"q1" | "q2" | "q3" | "q4" | "h1" | "h2", number>>;
  /** Optional closing line for comparison. */
  closing?: {
    family: "ml" | "spread" | "total" | "team_total";
    period: "fg" | "q1" | "q2" | "q3" | "q4" | "h1" | "h2";
    side: "home" | "away" | "over" | "under";
    line?: number;
    american?: number;
    impliedProbRaw?: number;
  };
};

export type SettledObservation = BinaryObservation & {
  eventId: string;
  marketId: string;
  family: string;
  period: string;
  engine: "v2" | "v1_frac";
};

export type CalibrationReport = {
  n: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  reliability: ReliabilityBin[];
  byFamily: Record<string, { n: number; brier: number | null; ece: number | null }>;
};

export function buildCalibrationReport(rows: SettledObservation[]): CalibrationReport {
  const byFamily: CalibrationReport["byFamily"] = {};
  for (const r of rows) {
    const key = `${r.family}:${r.period}`;
    if (!byFamily[key]) byFamily[key] = { n: 0, brier: null, ece: null };
    byFamily[key].n += 1;
  }
  for (const key of Object.keys(byFamily)) {
    const subset = rows.filter((r) => `${r.family}:${r.period}` === key);
    byFamily[key].brier = brierScore(subset);
    byFamily[key].ece = expectedCalibrationError(subset);
  }
  return {
    n: rows.length,
    brier: brierScore(rows),
    logLoss: logLoss(rows),
    ece: expectedCalibrationError(rows),
    reliability: reliabilityDiagram(rows),
    byFamily,
  };
}

/** Did the market win against actual scores? Uses same settlement rules as settle. */
export function actualHitFromScores(
  market: SimV2Market,
  home: number,
  away: number,
): 0 | 1 {
  const line = market.line ?? 0;
  const path = market.settlement.settlePath;
  let value: number;
  if (path.includes("total") || path.endsWith("totalFg") || path.includes("totalByPeriod")) {
    value = home + away;
  } else if (path.includes("margin") || path === "team.margin") {
    value = home - away;
  } else if (path.includes("home") || path === "team.homeFg") {
    value = home;
  } else if (path.includes("away") || path === "team.awayFg") {
    value = away;
  } else {
    return 0;
  }
  switch (market.settlement.comparator) {
    case "gt":
      return value > line ? 1 : 0;
    case "gte":
      return value >= line ? 1 : 0;
    case "lt":
      return value < line ? 1 : 0;
    case "lte":
      return value <= line ? 1 : 0;
    case "eq":
      return value === line ? 1 : 0;
    case "home_wins":
      return home > away ? 1 : 0;
    case "away_wins":
      return away > home ? 1 : 0;
    default:
      return 0;
  }
}

export function observeMarketSettlement(args: {
  tensor: SimV2ScenarioTensor;
  market: SimV2Market;
  odds: SimV2Odds;
  actualHome: number;
  actualAway: number;
  engine?: "v2" | "v1_frac";
}): SettledObservation | null {
  const result = settleMarket({
    tensor: args.tensor,
    market: args.market,
    odds: args.odds,
    periodSumGroup: ["q1", "q2", "q3", "q4"],
  });
  if (result.status !== "ok" || result.simHit == null) return null;
  return {
    p: result.simHit,
    y: actualHitFromScores(args.market, args.actualHome, args.actualAway),
    eventId: args.market.eventId,
    marketId: args.market.marketId,
    family: args.market.family,
    period: args.market.period,
    engine: args.engine ?? "v2",
  };
}

/**
 * V1-style independent period overwrite for comparison only.
 * Intentionally NOT conserved — documents Phase A/B risk.
 */
export function v1FracPeriodScores(
  homeFg: number,
  awayFg: number,
  period: "q1" | "q2" | "q3" | "q4" | "h1" | "h2",
  rng: () => number,
): { home: number; away: number } {
  const frac: Record<string, number> = {
    q1: 0.26,
    q2: 0.24,
    q3: 0.26,
    q4: 0.24,
    h1: 0.5,
    h2: 0.5,
  };
  const f = frac[period] ?? 0.25;
  const noiseH = 1 + (rng() - 0.5) * 0.14;
  const noiseA = 1 + (rng() - 0.5) * 0.14;
  return {
    home: Math.max(0, Math.round(homeFg * f * noiseH * 100) / 100),
    away: Math.max(0, Math.round(awayFg * f * noiseA * 100) / 100),
  };
}

export type V1CompareRow = {
  period: string;
  v2HomeMean: number;
  v2AwayMean: number;
  v1HomeMean: number;
  v1AwayMean: number;
  absDeltaHomePp: number;
  absDeltaAwayPp: number;
};

/**
 * Compare joint V2 period means vs V1 frac-of-FG on the same FG draws.
 * Reports absolute percentage-point gaps in period share of FG.
 */
export function compareJointVsV1Frac(tensor: SimV2ScenarioTensor, seed = "v1-compare"): {
  rows: V1CompareRow[];
  meanAbsDeltaPp: number;
  pctAtLeast5Pp: number;
  jointTotalFgMean: number;
  /** Fraction of draws where V1 Q1..Q4 home+away sum ≠ FG (noise breaks conservation). */
  v1PeriodSumBreakRate: number;
  /** Mean |V1 quarter-sum − FG| across draws (home+away combined points). */
  v1MeanAbsSumError: number;
  /** Joint model break rate — must be 0. */
  jointPeriodSumBreakRate: number;
} {
  const { next } = createSeededRng(seed);
  const n = tensor.meta.nDraws;
  const periods = ["q1", "q2", "q3", "q4"] as const;
  const rows: V1CompareRow[] = [];
  let absSum = 0;
  let absCount = 0;
  let ge5 = 0;

  // Per-draw V1 scores for conservation check.
  const v1HomeQ: Record<(typeof periods)[number], Float64Array> = {
    q1: new Float64Array(n),
    q2: new Float64Array(n),
    q3: new Float64Array(n),
    q4: new Float64Array(n),
  };
  const v1AwayQ: Record<(typeof periods)[number], Float64Array> = {
    q1: new Float64Array(n),
    q2: new Float64Array(n),
    q3: new Float64Array(n),
    q4: new Float64Array(n),
  };

  for (const period of periods) {
    let v2H = 0;
    let v2A = 0;
    let v1H = 0;
    let v1A = 0;
    let shareDeltaH = 0;
    let shareDeltaA = 0;
    for (let i = 0; i < n; i++) {
      const hFg = tensor.team.homeFg[i];
      const aFg = tensor.team.awayFg[i];
      const v2hp = tensor.team.homeByPeriod[period]![i];
      const v2ap = tensor.team.awayByPeriod[period]![i];
      const v1p = v1FracPeriodScores(hFg, aFg, period, next);
      v1HomeQ[period][i] = v1p.home;
      v1AwayQ[period][i] = v1p.away;
      v2H += v2hp;
      v2A += v2ap;
      v1H += v1p.home;
      v1A += v1p.away;
      const sH = hFg > 0 ? Math.abs(v2hp / hFg - v1p.home / hFg) * 100 : 0;
      const sA = aFg > 0 ? Math.abs(v2ap / aFg - v1p.away / aFg) * 100 : 0;
      shareDeltaH += sH;
      shareDeltaA += sA;
      absSum += sH + sA;
      absCount += 2;
      if (sH >= 5) ge5 += 1;
      if (sA >= 5) ge5 += 1;
    }
    rows.push({
      period,
      v2HomeMean: v2H / n,
      v2AwayMean: v2A / n,
      v1HomeMean: v1H / n,
      v1AwayMean: v1A / n,
      absDeltaHomePp: shareDeltaH / n,
      absDeltaAwayPp: shareDeltaA / n,
    });
  }

  let v1Breaks = 0;
  let jointBreaks = 0;
  let v1AbsErr = 0;
  for (let i = 0; i < n; i++) {
    const v1H =
      v1HomeQ.q1[i] + v1HomeQ.q2[i] + v1HomeQ.q3[i] + v1HomeQ.q4[i];
    const v1A =
      v1AwayQ.q1[i] + v1AwayQ.q2[i] + v1AwayQ.q3[i] + v1AwayQ.q4[i];
    const jH =
      tensor.team.homeByPeriod.q1![i] +
      tensor.team.homeByPeriod.q2![i] +
      tensor.team.homeByPeriod.q3![i] +
      tensor.team.homeByPeriod.q4![i];
    const jA =
      tensor.team.awayByPeriod.q1![i] +
      tensor.team.awayByPeriod.q2![i] +
      tensor.team.awayByPeriod.q3![i] +
      tensor.team.awayByPeriod.q4![i];
    const v1Err = Math.abs(v1H - tensor.team.homeFg[i]) + Math.abs(v1A - tensor.team.awayFg[i]);
    v1AbsErr += v1Err;
    if (v1Err > 1e-6) v1Breaks += 1;
    if (Math.abs(jH - tensor.team.homeFg[i]) > 1e-6 || Math.abs(jA - tensor.team.awayFg[i]) > 1e-6) {
      jointBreaks += 1;
    }
  }

  const summary = summarizeJointFootballTensor(tensor);
  return {
    rows,
    meanAbsDeltaPp: absCount ? absSum / absCount : 0,
    pctAtLeast5Pp: absCount ? (ge5 / absCount) * 100 : 0,
    jointTotalFgMean: summary.totalFgMean,
    v1PeriodSumBreakRate: v1Breaks / n,
    v1MeanAbsSumError: v1AbsErr / n,
    jointPeriodSumBreakRate: jointBreaks / n,
  };
}

export function orientationSanity(tensor: SimV2ScenarioTensor): {
  ok: boolean;
  homeStrongerThanAwayOnOffense: boolean | null;
  detail: string;
} {
  const s = summarizeJointFootballTensor(tensor);
  // Pure sanity: means finite and non-negative; orientation left to caller inputs.
  if (!Number.isFinite(s.homeFgMean) || !Number.isFinite(s.awayFgMean)) {
    return { ok: false, homeStrongerThanAwayOnOffense: null, detail: "non_finite_means" };
  }
  if (s.homeFgMean < 0 || s.awayFgMean < 0) {
    return { ok: false, homeStrongerThanAwayOnOffense: null, detail: "negative_means" };
  }
  return {
    ok: true,
    homeStrongerThanAwayOnOffense: s.homeFgMean > s.awayFgMean,
    detail: `homeFg=${s.homeFgMean.toFixed(2)} awayFg=${s.awayFgMean.toFixed(2)}`,
  };
}
