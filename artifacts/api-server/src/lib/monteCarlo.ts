// Monte Carlo prop simulator — 10,000 draws per prop using real game-log samples,
// pace, minutes, injuries, matchup splits, weather (MLB), and recent form.
// Outputs hit probability, most-likely stat line, and a confidence score.
// Designed as ONE input to the pick rubric, not a standalone oracle.
//
// Phase 1: one underlying sample draw can score every genuine alternate line
// (and both Over/Under) for the same player/event/stat/period/context.

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
  /** Extra lines scored on the SAME 10k draw (alt rungs). */
  additionalLines?: number[];
};

export type PropSimulationResult = {
  simulations: number;
  hitProbability: number | null;
  mostLikelyLine: number | null;
  meanProjection: number | null;
  medianProjection: number | null;
  confidenceScore: number | null;
  stdDev: number | null;
  sampleGames: number;
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number } | null;
  /** Hit rate per additional line on the same draw (key = line number string). */
  lineHitRates?: Record<string, number>;
  /**
   * Hit rates for every evaluated line × side from the same samples.
   * Used when one distribution scores a full alt ladder (Over and Under).
   */
  lineHitRatesBySide?: {
    Over: Record<string, number>;
    Under: Record<string, number>;
  };
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

/** Mulberry32 — deterministic when seed is provided (equivalence tests). */
export function createPropSimRng(seed?: number): () => number {
  if (seed == null || !Number.isFinite(seed)) {
    return () => Math.random();
  }
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(mean: number, std: number, rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

function poissonSample(lambda: number, rng: () => number): number {
  const L = Math.exp(-Math.max(lambda, 0.01));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
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

/** Hit rate from fixed samples — Over = P(X > line), Under = P(X < line). */
export function hitRateFromSamples(
  samples: readonly number[],
  line: number,
  side: PropSimSide,
): number {
  if (!samples.length || !Number.isFinite(line)) return 0;
  const hits =
    side === "Over"
      ? samples.filter((s) => s > line).length
      : samples.filter((s) => s < line).length;
  return hits / samples.length;
}

export function confidenceFromHit(
  hitProb: number,
  sampleGames: number,
  simMean: number,
  std: number,
  ctx: Pick<
    PropSimulationContext,
    "vsOpponentValues" | "minutesL5" | "minutesSeason" | "oppPace"
  >,
): number {
  let confidence = 50;
  if (sampleGames >= 8) confidence += 14;
  else if (sampleGames >= 5) confidence += 8;
  else confidence -= 6;

  const cv = simMean > 0 ? std / simMean : 1;
  if (cv < 0.22) confidence += 10;
  else if (cv < 0.38) confidence += 4;
  else confidence -= 4;

  confidence += Math.abs(hitProb - 0.5) * 40;

  if (ctx.vsOpponentValues && ctx.vsOpponentValues.length >= 2) confidence += 4;
  if (ctx.minutesL5 != null && ctx.minutesSeason != null) confidence += 3;
  if (ctx.oppPace != null) confidence += 3;

  return clamp(Math.round(confidence), 5, 95);
}

/** Draw the underlying stat distribution (line/side independent). */
export function drawPropStatSamples(
  ctx: Omit<PropSimulationContext, "line" | "side" | "additionalLines"> & {
    recentValues: number[];
  },
  simulations: number,
  rng: () => number = createPropSimRng(),
): { samples: number[]; mean: number; std: number } | null {
  const vals = ctx.recentValues.filter((v) => Number.isFinite(v));
  if (vals.length < 3) return null;
  const mean = buildProjectionMean({
    ...ctx,
    line: 0,
    side: "Over",
  } as PropSimulationContext);
  if (mean == null) return null;
  const historicalStd = sampleStd(vals);
  const std = Math.max(historicalStd, mean * 0.12, 0.35);
  const discrete = ctx.discrete ?? false;
  const samples: number[] = new Array(simulations);
  for (let i = 0; i < simulations; i++) {
    let draw: number;
    if (discrete && mean < 4) {
      draw = poissonSample(mean, rng);
    } else if (discrete) {
      draw = Math.max(0, Math.round(normalSample(mean, std, rng)));
    } else {
      draw = Math.max(0, normalSample(mean, std, rng));
    }
    samples[i] = draw;
  }
  return { samples, mean, std };
}

export type RunMonteCarloOpts = {
  /** Fixed seed for equivalence tests. Production leaves undefined (Math.random). */
  seed?: number;
  /**
   * Extra lines to score on the same draw (same side as ctx.side for lineHitRates,
   * both sides for lineHitRatesBySide).
   */
  evaluateLines?: number[];
};

export function runMonteCarloSimulation(
  ctx: PropSimulationContext,
  simulations = DEFAULT_SIMULATIONS,
  opts?: RunMonteCarloOpts,
): PropSimulationResult {
  const empty: PropSimulationResult = {
    simulations: 0,
    hitProbability: null,
    mostLikelyLine: null,
    meanProjection: null,
    medianProjection: null,
    confidenceScore: null,
    stdDev: null,
    sampleGames: ctx.recentValues.length,
    percentiles: null,
  };

  const vals = ctx.recentValues.filter((v) => Number.isFinite(v));
  if (vals.length < 3 || !Number.isFinite(ctx.line)) return empty;

  const rng = createPropSimRng(opts?.seed);
  const drawn = drawPropStatSamples(ctx, simulations, rng);
  if (!drawn) return empty;
  const { samples, std } = drawn;

  const sorted = [...samples].sort((a, b) => a - b);
  const simMean = avg(samples);
  const simMedian = percentile(sorted, 0.5);

  const hitProb = hitRateFromSamples(samples, ctx.line, ctx.side);

  const extraFromCtx = (ctx.additionalLines ?? []).filter(
    (l) => Number.isFinite(l) && l !== ctx.line,
  );
  const extraFromOpts = (opts?.evaluateLines ?? []).filter(
    (l) => Number.isFinite(l) && l !== ctx.line,
  );
  const allExtra = [...new Set([...extraFromCtx, ...extraFromOpts])].sort(
    (a, b) => a - b,
  );

  let lineHitRates: Record<string, number> | undefined;
  if (allExtra.length > 0) {
    lineHitRates = {};
    for (const ln of allExtra) {
      lineHitRates[String(ln)] = round3(hitRateFromSamples(samples, ln, ctx.side));
    }
  }

  // Always publish both-side rates for primary + extras (shared-dist consumers).
  const allLines = [ctx.line, ...allExtra];
  const lineHitRatesBySide = {
    Over: {} as Record<string, number>,
    Under: {} as Record<string, number>,
  };
  for (const ln of allLines) {
    lineHitRatesBySide.Over[String(ln)] = round3(
      hitRateFromSamples(samples, ln, "Over"),
    );
    lineHitRatesBySide.Under[String(ln)] = round3(
      hitRateFromSamples(samples, ln, "Under"),
    );
  }

  return {
    simulations,
    hitProbability: round3(hitProb),
    mostLikelyLine: modeRounded(samples),
    meanProjection: round2(simMean),
    medianProjection: round2(simMedian),
    confidenceScore: confidenceFromHit(hitProb, vals.length, simMean, std, ctx),
    stdDev: round2(std),
    sampleGames: vals.length,
    percentiles: {
      p10: round2(percentile(sorted, 0.1)),
      p25: round2(percentile(sorted, 0.25)),
      p50: round2(percentile(sorted, 0.5)),
      p75: round2(percentile(sorted, 0.75)),
      p90: round2(percentile(sorted, 0.9)),
    },
    ...(lineHitRates ? { lineHitRates } : {}),
    lineHitRatesBySide,
  };
}

export type SharedDrawScoreBundle = {
  samples: number[] | null;
  /** Shared projection stats (null when draw failed). */
  shared: Omit<
    PropSimulationResult,
    "hitProbability" | "confidenceScore" | "lineHitRates" | "lineHitRatesBySide"
  > | null;
  results: Array<PropSimulationResult & { line: number; side: PropSimSide }>;
  lineHitRatesBySide: NonNullable<PropSimulationResult["lineHitRatesBySide"]> | null;
};

/**
 * Score many (line, side) pairs from one shared draw.
 * With a fixed seed, each target matches a per-line `runMonteCarloSimulation`
 * that used the same seed (distribution is line/side-independent).
 */
export function scoreLinesFromSharedSamples(
  base: Omit<PropSimulationContext, "line" | "side" | "additionalLines">,
  targets: Array<{ line: number; side: PropSimSide }>,
  simulations = DEFAULT_SIMULATIONS,
  opts?: { seed?: number; evaluateLines?: number[] },
): Array<PropSimulationResult & { line: number; side: PropSimSide }> {
  return scoreSharedDistribution(base, targets, simulations, opts).results;
}

/**
 * Score provider thresholds against an existing draw (no new Monte Carlo).
 * Over = P(X > line), Under = P(X < line) — both sides from the same samples.
 */
export function scoreTargetsFromSamples(
  samples: readonly number[],
  shared: {
    simulations: number;
    mostLikelyLine: number | null;
    meanProjection: number | null;
    medianProjection: number | null;
    stdDev: number | null;
    sampleGames: number;
    percentiles: PropSimulationResult["percentiles"];
  },
  targets: Array<{ line: number; side: PropSimSide }>,
  confidenceCtx: Pick<
    PropSimulationContext,
    "vsOpponentValues" | "minutesL5" | "minutesSeason" | "oppPace"
  >,
  evaluateLines?: number[],
): SharedDrawScoreBundle {
  const lineSet = new Set<number>();
  for (const t of targets) {
    if (Number.isFinite(t.line)) lineSet.add(t.line);
  }
  for (const ln of evaluateLines ?? []) {
    if (Number.isFinite(ln)) lineSet.add(ln);
  }
  const allLines = [...lineSet].sort((a, b) => a - b);
  const lineHitRatesBySide = {
    Over: {} as Record<string, number>,
    Under: {} as Record<string, number>,
  };
  for (const ln of allLines) {
    lineHitRatesBySide.Over[String(ln)] = round3(hitRateFromSamples(samples, ln, "Over"));
    lineHitRatesBySide.Under[String(ln)] = round3(hitRateFromSamples(samples, ln, "Under"));
  }

  const simMean = shared.meanProjection ?? 0;
  const std = shared.stdDev ?? 0;
  const results = targets.map((t) => {
    const hitProb = hitRateFromSamples(samples, t.line, t.side);
    return {
      line: t.line,
      side: t.side,
      simulations: shared.simulations,
      hitProbability: round3(hitProb),
      mostLikelyLine: shared.mostLikelyLine,
      meanProjection: shared.meanProjection,
      medianProjection: shared.medianProjection,
      stdDev: shared.stdDev,
      sampleGames: shared.sampleGames,
      percentiles: shared.percentiles,
      confidenceScore: confidenceFromHit(
        hitProb,
        shared.sampleGames,
        simMean,
        std,
        confidenceCtx,
      ),
      lineHitRatesBySide,
    };
  });

  return {
    samples: samples as number[],
    shared: {
      simulations: shared.simulations,
      mostLikelyLine: shared.mostLikelyLine,
      meanProjection: shared.meanProjection,
      medianProjection: shared.medianProjection,
      stdDev: shared.stdDev,
      sampleGames: shared.sampleGames,
      percentiles: shared.percentiles,
    },
    results,
    lineHitRatesBySide,
  };
}

/** Draw once; return per-target rows plus full line×side hit maps. */
export function scoreSharedDistribution(
  base: Omit<PropSimulationContext, "line" | "side" | "additionalLines">,
  targets: Array<{ line: number; side: PropSimSide }>,
  simulations = DEFAULT_SIMULATIONS,
  opts?: { seed?: number; evaluateLines?: number[] },
): SharedDrawScoreBundle {
  const emptyRow = (t: { line: number; side: PropSimSide }) => ({
    line: t.line,
    side: t.side,
    simulations: 0,
    hitProbability: null,
    mostLikelyLine: null,
    meanProjection: null,
    medianProjection: null,
    confidenceScore: null,
    stdDev: null,
    sampleGames: base.recentValues.length,
    percentiles: null,
  });

  const rng = createPropSimRng(opts?.seed);
  const drawn = drawPropStatSamples(base, simulations, rng);
  if (!drawn) {
    return {
      samples: null,
      shared: null,
      results: targets.map(emptyRow),
      lineHitRatesBySide: null,
    };
  }

  const { samples, std } = drawn;
  const sorted = [...samples].sort((a, b) => a - b);
  const simMean = avg(samples);
  const simMedian = percentile(sorted, 0.5);
  const vals = base.recentValues.filter((v) => Number.isFinite(v));
  const shared = {
    simulations,
    mostLikelyLine: modeRounded(samples),
    meanProjection: round2(simMean),
    medianProjection: round2(simMedian),
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

  const lineSet = new Set<number>();
  for (const t of targets) {
    if (Number.isFinite(t.line)) lineSet.add(t.line);
  }
  for (const ln of opts?.evaluateLines ?? []) {
    if (Number.isFinite(ln)) lineSet.add(ln);
  }
  const allLines = [...lineSet].sort((a, b) => a - b);
  const lineHitRatesBySide = {
    Over: {} as Record<string, number>,
    Under: {} as Record<string, number>,
  };
  for (const ln of allLines) {
    lineHitRatesBySide.Over[String(ln)] = round3(hitRateFromSamples(samples, ln, "Over"));
    lineHitRatesBySide.Under[String(ln)] = round3(hitRateFromSamples(samples, ln, "Under"));
  }

  const results = targets.map((t) => {
    const hitProb = hitRateFromSamples(samples, t.line, t.side);
    return {
      line: t.line,
      side: t.side,
      ...shared,
      hitProbability: round3(hitProb),
      confidenceScore: confidenceFromHit(hitProb, vals.length, simMean, std, base),
      lineHitRatesBySide,
    };
  });

  return { samples, shared, results, lineHitRatesBySide };
}

export function simulationKey(
  player: string,
  market: string,
  line: number,
  side: PropSimSide,
): string {
  return `${player}|${market}|${line}|${side}`;
}
