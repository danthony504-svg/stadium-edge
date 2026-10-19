/**
 * Derive Opportunity Shift channelUsage from already-loaded ESPN game logs.
 * Sync only — no I/O. Used by runPropSims after the parallel history wave.
 */

import type { PlayerHistoryShape } from "../monteCarloBuild.js";
import type { WorkloadChannel } from "./types.js";

/** Min games with a finite stat before a beneficiary's usage counts as reliable. */
export const USAGE_MIN_GAMES = 2;
/** Prefer L5 when at least this many recent games exist. */
export const USAGE_L5_PREFERRED_MIN = 3;
/** Season/log mean usable when L5 is thin. */
export const USAGE_SEASON_FALLBACK_MIN = 3;
/** Soft prior for beneficiaries missing usage when peers are grounded. */
export const USAGE_MISSING_PRIOR_FRAC = 0.35;
/** Max share when hierarchy evidence is weak. */
export const USAGE_WEAK_DOMINANCE_CAP = 0.78;
/** Max share when evidence is strong (still avoid 100% from one noisy series). */
export const USAGE_STRONG_DOMINANCE_CAP = 0.92;
/** Games below this (per beneficiary) mark evidence weak for dominance capping. */
export const USAGE_WEAK_SAMPLE_MAX = 3;

export type ChannelUsageDeriveResult = {
  channelUsage: Partial<Record<WorkloadChannel, number>>;
  channelUsageSamples: Partial<Record<WorkloadChannel, number>>;
  /** True when at least one channel has reliable grounded usage. */
  hasGroundedUsage: boolean;
};

type HistGame = { stats: Record<string, string> };

function numStat(stats: Record<string, string>, labels: string[], elapsed = false): number | null {
  for (const lab of labels) {
    const raw = stats[lab];
    if (raw == null || raw === "" || raw === "-") continue;
    const time = elapsed ? raw.match(/^(\d+):(\d{2})$/) : null;
    const n = time && Number(time[2]) < 60 ? Number(time[1]) + Number(time[2]) / 60 : Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** Winsorize series so one outlier game cannot dominate role. */
export function winsorizeSeries(values: number[]): number[] {
  if (values.length < 3) return [...values];
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor((sorted.length - 1) * 0.2)]!;
  const hi = sorted[Math.floor((sorted.length - 1) * 0.8)]!;
  return values.map((v) => Math.max(lo, Math.min(hi, v)));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Priority: L5 (winsorized) when sample ≥ 3; else season/log mean when ≥ 3;
 * else L5/log mean when ≥ USAGE_MIN_GAMES; blend L5+season when both available.
 */
export function groundedUsageFromSeries(raw: number[]): {
  usage: number | null;
  sampleSize: number;
} {
  const finite = raw.filter((v) => Number.isFinite(v) && v >= 0);
  const n = finite.length;
  if (n < USAGE_MIN_GAMES) return { usage: null, sampleSize: n };

  const w = winsorizeSeries(finite);
  const l5n = Math.min(5, w.length);
  const l5 = mean(w.slice(0, l5n));
  const season = mean(w);

  if (l5n >= USAGE_L5_PREFERRED_MIN && n >= USAGE_SEASON_FALLBACK_MIN) {
    // Trend blend: recent form + season anchor.
    return { usage: 0.65 * l5 + 0.35 * season, sampleSize: n };
  }
  if (l5n >= USAGE_L5_PREFERRED_MIN) {
    return { usage: l5, sampleSize: n };
  }
  if (n >= USAGE_SEASON_FALLBACK_MIN) {
    return { usage: season, sampleSize: n };
  }
  // Thin but usable (n === 2).
  return { usage: mean(w), sampleSize: n };
}

function seriesForLabels(games: HistGame[], labels: string[], elapsed = false): number[] {
  const out: number[] = [];
  for (const g of games) {
    const v = numStat(g.stats ?? {}, labels, elapsed);
    if (v != null) out.push(v);
  }
  return out;
}

/** Channel → ESPN machine / display labels (newest-first recent[]). */
const CHANNEL_STAT_LABELS: Partial<Record<WorkloadChannel, string[]>> = {
  carries: ["rushingAttempts", "CAR"],
  targets: ["receivingTargets", "TGTS", "targets"],
  routes: ["routes", "routesRun"],
  rz_carries: ["redZoneRushingAttempts"],
  gl_carries: ["goalLineRushingAttempts"],
  pass_attempts: ["passingAttempts"],
  designed_runs: ["designedRushingAttempts"],
  minutes: ["MIN", "minutes"],
  fga: ["FGA", "fieldGoalsAttempted"],
  reb_opps: ["reboundChances"],
  ast_opps: ["potentialAssists"],
  usage: ["USG%", "usage"],
  pa: ["PA", "plateAppearances"],
  rbi_opps: ["rbiOpportunities"],
  run_opps: ["runScoringOpportunities"],
  sb_opps: ["stolenBaseOpportunities"],
  toi: ["TOI", "timeOnIce"],
  pp_toi: ["PPTOI", "powerPlayTimeOnIce"],
  shot_share: ["SH", "S", "SOG", "shots", "shotsOnGoal"],
  point_opps: ["pointOpportunities"],
  shot_opps: ["SH", "S", "shots"],
  sot_opps: ["SOT", "shotsOnTarget"],
};

export function deriveChannelUsageFromHistory(
  history: PlayerHistoryShape | null | undefined,
): ChannelUsageDeriveResult {
  const empty: ChannelUsageDeriveResult = {
    channelUsage: {},
    channelUsageSamples: {},
    hasGroundedUsage: false,
  };
  const games = history?.recent ?? [];
  if (!games.length) return empty;

  const channelUsage: Partial<Record<WorkloadChannel, number>> = {};
  const channelUsageSamples: Partial<Record<WorkloadChannel, number>> = {};

  const channels = Object.keys(CHANNEL_STAT_LABELS) as WorkloadChannel[];
  for (const ch of channels) {
    const labels = CHANNEL_STAT_LABELS[ch]!;
    const series = seriesForLabels(games, labels, ["minutes", "toi", "pp_toi"].includes(ch));
    const { usage, sampleSize } = groundedUsageFromSeries(series);
    if (usage != null && usage >= 0) {
      channelUsage[ch] = usage;
      channelUsageSamples[ch] = sampleSize;
    }
  }

  return {
    channelUsage,
    channelUsageSamples,
    hasGroundedUsage: Object.keys(channelUsage).length > 0,
  };
}

/**
 * Normalize raw channel usages into share weights with missing-prior + dominance caps.
 * weight_i = usage_i / Σ usage  (after priors/caps).
 */
export function normalizeUsageWeights(
  usages: Array<{ id: string; usage: number | null; sampleSize: number }>,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (!usages.length) return weights;

  const reliable = usages.filter(
    (u) => u.usage != null && u.usage > 0 && u.sampleSize >= USAGE_MIN_GAMES,
  );
  if (!reliable.length) {
    const eq = 1 / usages.length;
    for (const u of usages) weights.set(u.id, eq);
    return weights;
  }

  const meanReliable =
    reliable.reduce((a, u) => a + (u.usage as number), 0) / reliable.length;
  const evidenceWeak =
    reliable.some((u) => u.sampleSize <= USAGE_WEAK_SAMPLE_MAX) ||
    reliable.length < usages.length;

  const raw = new Map<string, number>();
  for (const u of usages) {
    if (u.usage != null && u.usage >= 0 && u.sampleSize >= USAGE_MIN_GAMES) {
      raw.set(u.id, u.usage);
    } else {
      raw.set(u.id, meanReliable * USAGE_MISSING_PRIOR_FRAC);
    }
  }

  let sum = 0;
  for (const v of raw.values()) sum += v;
  if (sum <= 0) {
    const eq = 1 / usages.length;
    for (const u of usages) weights.set(u.id, eq);
    return weights;
  }

  const cap = evidenceWeak ? USAGE_WEAK_DOMINANCE_CAP : USAGE_STRONG_DOMINANCE_CAP;
  // First pass normalize + clamp
  for (const [id, v] of raw) {
    weights.set(id, Math.min(cap, v / sum));
  }
  // Renormalize after clamp
  let sum2 = 0;
  for (const v of weights.values()) sum2 += v;
  if (sum2 <= 0) {
    const eq = 1 / usages.length;
    for (const u of usages) weights.set(u.id, eq);
    return weights;
  }
  for (const [id, v] of weights) weights.set(id, v / sum2);
  return weights;
}
