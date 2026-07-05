import { collectMonteCarloSamples, finalizeSimRunStats, emptySimRunStats } from "./simRunStats.js";
import type { SimRunStats } from "./simRunStats.js";

// Monte Carlo prop simulator — 10,000 draws per prop using real game-log samples,
// Outputs hit probability, most-likely stat line, and a confidence score.
// Designed as ONE input to the pick rubric, not a standalone oracle.

export const QUICK_SIMULATIONS = 1_000;
export const DEEP_SIMULATIONS = 10_000;
export const DEFAULT_SIMULATIONS = DEEP_SIMULATIONS;

export type PropSimSide = "Over" | "Under";

export type PropSimulationContext = {
  sport: string;
  market: string;
  line: number;
  side: PropSimSide;
  /** Per-game stat values, newest first. */
  recentValues: number[];
  vsOpponentValues?: number[];
  homeValues?: number[];
  awayValues?: number[];
  isHome?: boolean | null;
  minutesL5?: number | null;
  minutesSeason?: number | null;
  minutesDirection?: "up" | "down" | "steady";
  /** Opponent possessions-per-game pace (NBA/WNBA). */
  oppPace?: number | null;
  leaguePace?: number | null;
  /** Weighted key-injury counts (high=2, med=1) for opponent / own team. */
  oppKeyInjuries?: number;
  ownKeyInjuries?: number;
  /** MLB weather impact rating roughly -1..1 (negative = pitcher-friendly). */
  weatherImpact?: number | null;
  discrete?: boolean;
};

export type PropSimulationResult = SimRunStats & {
  /** @deprecated use completedSims — kept for backward compatibility */
  simulations: number;
  hitProbability: number | null;
  mostLikelyLine: number | null;
  meanProjection: number | null;
  medianProjection: number | null;
  confidenceScore: number | null;
  stdDev: number | null;
  sampleGames: number;
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number } | null;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sampleStd(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = avg(vals);
  const v = vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(Math.max(v, 0));
}

// Box-Muller — deterministic enough for sports sims; seed not required per draw.
function normalSample(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

function poissonSample(lambda: number): number {
  const L = Math.exp(-Math.max(lambda, 0.01));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function modeRounded(samples: number[], step = 0.5): number {
  const counts = new Map<number, number>();
  for (const s of samples) {
    const bucket = Math.round(s / step) * step;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  let best = samples[Math.floor(samples.length / 2)] ?? 0;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = k;
    }
  }
  return round2(best);
}

export function buildProjectionMean(ctx: PropSimulationContext): number | null {
  const vals = ctx.recentValues.filter((v) => Number.isFinite(v));
  if (vals.length < 3) return null;

  const l5 = vals.slice(0, 5);
  const l10 = vals.slice(0, 10);
  const mean5 = avg(l5);
  const mean10 = l10.length ? avg(l10) : mean5;
  const meanSeason = avg(vals);
  let mean = 0.4 * mean5 + 0.3 * mean10 + 0.3 * meanSeason;

  const vs = (ctx.vsOpponentValues ?? []).filter((v) => Number.isFinite(v));
  if (vs.length >= 2) mean = 0.78 * mean + 0.22 * avg(vs);

  if (ctx.isHome === true) {
    const hv = (ctx.homeValues ?? []).filter((v) => Number.isFinite(v));
    if (hv.length >= 3) mean = 0.88 * mean + 0.12 * avg(hv);
  } else if (ctx.isHome === false) {
    const av = (ctx.awayValues ?? []).filter((v) => Number.isFinite(v));
    if (av.length >= 3) mean = 0.88 * mean + 0.12 * avg(av);
  }

  if (
    ctx.oppPace != null &&
    ctx.leaguePace != null &&
    ctx.leaguePace > 0 &&
    (ctx.sport === "nba" || ctx.sport === "wnba")
  ) {
    mean *= clamp(ctx.oppPace / ctx.leaguePace, 0.88, 1.12);
  }

  if (ctx.minutesL5 != null && ctx.minutesSeason != null && ctx.minutesSeason > 5) {
    mean *= clamp(ctx.minutesL5 / ctx.minutesSeason, 0.72, 1.28);
  } else if (ctx.minutesDirection === "up") {
    mean *= 1.04;
  } else if (ctx.minutesDirection === "down") {
    mean *= 0.96;
  }

  const oppInj = ctx.oppKeyInjuries ?? 0;
  const ownInj = ctx.ownKeyInjuries ?? 0;
  mean *= clamp(1 + oppInj * 0.015 - ownInj * 0.02, 0.88, 1.12);

  if (ctx.weatherImpact != null && ctx.sport === "mlb") {
    const w = clamp(ctx.weatherImpact, -1, 1);
    if (/home_run|total_base|hits/i.test(ctx.market)) mean *= 1 + w * 0.1;
    else if (/strikeout|pitcher/i.test(ctx.market)) mean *= 1 - w * 0.06;
  }

  return Math.max(0, mean);
}

export function runMonteCarloSimulation(
  ctx: PropSimulationContext,
  simulations = DEFAULT_SIMULATIONS,
): PropSimulationResult {
  const startedAt = new Date();
  const baseEmpty = (sampleGames: number): PropSimulationResult => ({
    ...emptySimRunStats(simulations, sampleGames),
    simulations: 0,
    hitProbability: null,
    mostLikelyLine: null,
    meanProjection: null,
    medianProjection: null,
    confidenceScore: null,
    stdDev: null,
    sampleGames,
    percentiles: null,
  });

  const vals = ctx.recentValues.filter((v) => Number.isFinite(v));
  if (vals.length < 3 || !Number.isFinite(ctx.line)) return baseEmpty(vals.length);

  const mean = buildProjectionMean(ctx);
  if (mean == null) return baseEmpty(vals.length);

  const historicalStd = sampleStd(vals);
  const std = Math.max(historicalStd, mean * 0.12, 0.35);
  const discrete = ctx.discrete ?? false;

  const { samples, completedSims, failedSims } = collectMonteCarloSamples(simulations, () => {
    if (discrete && mean < 4) return poissonSample(mean);
    if (discrete) return Math.max(0, Math.round(normalSample(mean, std)));
    return Math.max(0, normalSample(mean, std));
  });

  const runMeta = finalizeSimRunStats(startedAt, simulations, completedSims, failedSims, vals.length);
  if (completedSims === 0) {
    return { ...baseEmpty(vals.length), ...runMeta };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const simMean = avg(samples);
  const simMedian = percentile(sorted, 0.5);

  const hits =
    ctx.side === "Over"
      ? samples.filter((s) => s > ctx.line).length
      : samples.filter((s) => s < ctx.line).length;
  const hitProb = hits / completedSims;

  let confidence = 50;
  if (vals.length >= 8) confidence += 14;
  else if (vals.length >= 5) confidence += 8;
  else confidence -= 6;

  const cv = simMean > 0 ? std / simMean : 1;
  if (cv < 0.22) confidence += 10;
  else if (cv < 0.38) confidence += 4;
  else confidence -= 4;

  const edgeFrom50 = Math.abs(hitProb - 0.5);
  confidence += edgeFrom50 * 40;
  if (completedSims >= DEEP_SIMULATIONS) confidence += 10;
  else if (completedSims >= QUICK_SIMULATIONS) confidence += 4;

  if (ctx.vsOpponentValues && ctx.vsOpponentValues.length >= 2) confidence += 4;
  if (ctx.minutesL5 != null && ctx.minutesSeason != null) confidence += 3;
  if (ctx.oppPace != null) confidence += 3;

  return {
    ...runMeta,
    simulations: completedSims,
    hitProbability: round3(hitProb),
    mostLikelyLine: modeRounded(samples),
    meanProjection: round2(simMean),
    medianProjection: round2(simMedian),
    confidenceScore: clamp(Math.round(confidence), 5, 95),
    stdDev: round2(std),
    sampleGames: vals.length,
    percentiles: {
      p10: round2(percentile(sorted, 0.1)),
      p25: round2(percentile(sorted, 0.25)),
      p50: round2(percentile(sorted, 0.5)),
      p75: round2(percentile(sorted, 0.75)),
      p90: round2(percentile(sorted, 0.9)),
    },
  };
}

export function simulationKey(
  player: string,
  market: string,
  line: number,
  side: PropSimSide,
): string {
  return `${player}|${market}|${line}|${side}`;
}
