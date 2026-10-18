/**
 * Stage 4 P1 — shadow defenseIndex comparison.
 *
 * Computes baseline vs defense-adjusted hit probabilities for lineage /
 * calibration only. NEVER writes into Coach seating maps, grades, confidence,
 * edge, or ticket assembly.
 *
 * Default path is a local normal-CDF estimate from baseline mean/std × index
 * (no extra Odds API / team-defense fetches). Optional capped re-sim is
 * behind STAGE4_DEFENSE_INDEX_SHADOW_RESIM and stays off the critical path.
 */

import {
  buildDefenseIndexByFamily,
  defenseIndexFamilyForMarket,
  indexForMarket,
  type DefenseIndexBuildResult,
  type DefenseIndexByFamily,
  type DefenseIndexShrinkConfig,
} from "./defenseIndexFromPack.ts";
import type { FootballOppDefenseSlice } from "./footballRushDefense.ts";

/** Soft cap on shadow rows recorded per Coach run (bounded CPU). */
export const STAGE4_SHADOW_MAX_ROWS = 12;

/**
 * P1 shadow metrics on by default; set STAGE4_DEFENSE_INDEX_SHADOW=0
 * (or EXPO_PUBLIC_…) to disable. Never enables seating (P2+).
 */
export function isDefenseIndexShadowEnabled(): boolean {
  try {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const v =
      env?.EXPO_PUBLIC_STAGE4_DEFENSE_INDEX_SHADOW ??
      env?.STAGE4_DEFENSE_INDEX_SHADOW;
    if (v === "0" || v === "false" || v === "off") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export type DefenseIndexShadowIdentity = {
  athleteId: string | null;
  eventId: string | null;
  market: string;
  side: "Over" | "Under";
  line: number;
  player?: string | null;
  sport: string;
  opponentTeamId: string;
};

export type DefenseIndexShadowRow = {
  identity: DefenseIndexShadowIdentity;
  family: string | null;
  defenseIndex: number | null;
  sampleSize: number | null;
  baselineHit: number | null;
  shadowHit: number | null;
  deltaHit: number | null;
  baselineMean: number | null;
  shadowMean: number | null;
  stdDev: number | null;
  skippedReason: string | null;
  /** True when estimate used defenseIndex only (vs-opp not re-applied in shadow mean). */
  shadowAvoidsVsOppDoubleCount: true;
  lineage: {
    explainStat: string | null;
    rawRatio: number | null;
    shrinkPriorGames: number;
    matchupMin: number;
    matchupMax: number;
    packTeamName: string | null;
    method: "local_normal_cdf" | "skipped";
  };
};

export type DefenseIndexShadowReport = {
  enabled: true;
  rows: DefenseIndexShadowRow[];
  buildByOpponent: Record<string, DefenseIndexBuildResult>;
  metrics: {
    rowCount: number;
    indexedCount: number;
    skippedCount: number;
    meanAbsDeltaHit: number | null;
    maxAbsDeltaHit: number | null;
    elapsedMs: number;
  };
};

const reports: DefenseIndexShadowReport[] = [];

/** Test/harness access — Coach seating must never read this. */
export function drainDefenseIndexShadowReports(): DefenseIndexShadowReport[] {
  return reports.splice(0, reports.length);
}

export function peekDefenseIndexShadowReports(): readonly DefenseIndexShadowReport[] {
  return reports;
}

export function clearDefenseIndexShadowReports(): void {
  reports.length = 0;
}

/** Standard normal CDF (Abramowitz–Stegun 26.2.17). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * Approximate Over/Under hit from N(mean, std) vs line.
 * Shadow-only — not a substitute for exact-market 10K.
 */
export function approxHitFromMeanStd(opts: {
  mean: number;
  stdDev: number;
  line: number;
  side: "Over" | "Under";
}): number | null {
  const { mean, stdDev, line, side } = opts;
  if (![mean, stdDev, line].every(Number.isFinite) || stdDev <= 1e-6) return null;
  const z = (line - mean) / stdDev;
  // P(X > line) ≈ 1 - Φ((line-μ)/σ); continuity: use line as threshold.
  const pOver = 1 - normalCdf(z);
  const hit = side === "Over" ? pOver : 1 - pOver;
  return Math.round(Math.max(0, Math.min(1, hit)) * 1000) / 1000;
}

/**
 * Shadow mean applies defenseIndex as a solitary mean multiplier.
 * Does NOT re-apply vs-opponent / venue / opportunity — those already sit
 * inside the baseline mean from the live 10K. This prevents double-counting
 * vsOpp in the shadow delta.
 */
export function shadowMeanFromBaseline(
  baselineMean: number,
  defenseIndex: number,
): number {
  if (!Number.isFinite(baselineMean) || !Number.isFinite(defenseIndex) || defenseIndex <= 0) {
    return baselineMean;
  }
  return baselineMean * defenseIndex;
}

export function buildShadowRow(opts: {
  identity: DefenseIndexShadowIdentity;
  baselineHit: number | null;
  baselineMean: number | null;
  stdDev: number | null;
  build: DefenseIndexBuildResult;
}): DefenseIndexShadowRow {
  const fam = defenseIndexFamilyForMarket(opts.identity.market);
  const idx = indexForMarket(opts.build.defenseIndexByFamily, opts.identity.market);
  const expl = fam ? opts.build.explain.find((e) => e.family === fam) : undefined;
  const skip = !fam
    ? opts.build.skipped.find((s) => s.family === "*") ?? {
        reason: "family_excluded",
        detail: "no family map",
      }
    : idx == null
      ? opts.build.skipped.find((s) => s.family === fam || s.family === "*")
      : null;

  if (idx == null || opts.baselineMean == null || opts.stdDev == null) {
    return {
      identity: opts.identity,
      family: fam,
      defenseIndex: idx,
      sampleSize: expl?.sampleSize ?? null,
      baselineHit: opts.baselineHit,
      shadowHit: null,
      deltaHit: null,
      baselineMean: opts.baselineMean,
      shadowMean: null,
      stdDev: opts.stdDev,
      skippedReason: skip
        ? `${skip.reason}${skip.detail ? `:${skip.detail}` : ""}`
        : idx == null
          ? "no_index"
          : "missing_mean_or_std",
      shadowAvoidsVsOppDoubleCount: true,
      lineage: {
        explainStat: expl?.stat ?? null,
        rawRatio: expl?.raw ?? null,
        shrinkPriorGames: opts.build.config.shrinkPriorGames,
        matchupMin: opts.build.config.matchupMin,
        matchupMax: opts.build.config.matchupMax,
        packTeamName: null,
        method: "skipped",
      },
    };
  }

  const shadowMean = shadowMeanFromBaseline(opts.baselineMean, idx);
  const shadowHit = approxHitFromMeanStd({
    mean: shadowMean,
    stdDev: opts.stdDev,
    line: opts.identity.line,
    side: opts.identity.side,
  });
  const delta =
    shadowHit != null && opts.baselineHit != null
      ? Math.round((shadowHit - opts.baselineHit) * 1000) / 1000
      : shadowHit != null
        ? null
        : null;

  return {
    identity: opts.identity,
    family: fam,
    defenseIndex: idx,
    sampleSize: expl?.sampleSize ?? null,
    baselineHit: opts.baselineHit,
    shadowHit,
    deltaHit:
      shadowHit != null && opts.baselineHit != null
        ? Math.round((shadowHit - opts.baselineHit) * 1000) / 1000
        : delta,
    baselineMean: opts.baselineMean,
    shadowMean: Math.round(shadowMean * 1000) / 1000,
    stdDev: opts.stdDev,
    skippedReason: null,
    shadowAvoidsVsOppDoubleCount: true,
    lineage: {
      explainStat: expl?.stat ?? null,
      rawRatio: expl?.raw ?? null,
      shrinkPriorGames: opts.build.config.shrinkPriorGames,
      matchupMin: opts.build.config.matchupMin,
      matchupMax: opts.build.config.matchupMax,
      packTeamName: null,
      method: "local_normal_cdf",
    },
  };
}

export type ShadowPropInput = {
  sport: string;
  opponentTeamId: string;
  athleteId?: string | null;
  eventId?: string | null;
  player?: string | null;
  market: string;
  side: "Over" | "Under";
  line: number;
  baselineHit: number | null;
  baselineMean: number | null;
  stdDev: number | null;
  pack: FootballOppDefenseSlice | null | undefined;
  ownPack?: FootballOppDefenseSlice | null;
  fetchedAtMs?: number | null;
};

/**
 * Record a bounded shadow report. Safe to call from Coach after baseline sims —
 * must not feed return value into seating.
 */
export function recordDefenseIndexShadow(opts: {
  props: readonly ShadowPropInput[];
  config?: Partial<DefenseIndexShrinkConfig>;
  maxRows?: number;
}): DefenseIndexShadowReport {
  const t0 = Date.now();
  const maxRows = opts.maxRows ?? STAGE4_SHADOW_MAX_ROWS;
  const buildByOpponent: Record<string, DefenseIndexBuildResult> = {};
  const rows: DefenseIndexShadowRow[] = [];

  for (const p of opts.props) {
    if (rows.length >= maxRows) break;
    const opp = String(p.opponentTeamId ?? "").trim();
    const sport = String(p.sport ?? "").toLowerCase();
    if (!opp || !sport) continue;
    const key = `${sport}#${opp}`;
    if (!buildByOpponent[key]) {
      buildByOpponent[key] = buildDefenseIndexByFamily({
        sport,
        opponentTeamId: opp,
        oppPack: p.pack,
        ownPack: p.ownPack,
        fetchedAtMs: p.fetchedAtMs,
        config: opts.config,
      });
    }
    const build = buildByOpponent[key]!;
    const row = buildShadowRow({
      identity: {
        athleteId: p.athleteId ?? null,
        eventId: p.eventId ?? null,
        market: p.market,
        side: p.side,
        line: p.line,
        player: p.player ?? null,
        sport,
        opponentTeamId: opp,
      },
      baselineHit: p.baselineHit,
      baselineMean: p.baselineMean,
      stdDev: p.stdDev,
      build,
    });
    row.lineage.packTeamName = p.pack?.teamName ?? null;
    rows.push(row);
  }

  const indexed = rows.filter((r) => r.defenseIndex != null && r.shadowHit != null);
  const absDeltas = indexed
    .map((r) => (r.deltaHit != null ? Math.abs(r.deltaHit) : null))
    .filter((x): x is number => x != null);
  const report: DefenseIndexShadowReport = {
    enabled: true,
    rows,
    buildByOpponent,
    metrics: {
      rowCount: rows.length,
      indexedCount: indexed.length,
      skippedCount: rows.length - indexed.length,
      meanAbsDeltaHit:
        absDeltas.length > 0
          ? Math.round(
              (absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length) * 1000,
            ) / 1000
          : null,
      maxAbsDeltaHit:
        absDeltas.length > 0
          ? Math.round(Math.max(...absDeltas) * 1000) / 1000
          : null,
      elapsedMs: Date.now() - t0,
    },
  };
  reports.push(report);
  return report;
}

/** Build indices map for a single opponent — pure helper for tests/scripts. */
export function shadowDefenseIndexByFamilyForOpponent(opts: {
  sport: string;
  opponentTeamId: string;
  pack: FootballOppDefenseSlice | null | undefined;
  config?: Partial<DefenseIndexShrinkConfig>;
}): DefenseIndexByFamily {
  return buildDefenseIndexByFamily({
    sport: opts.sport,
    opponentTeamId: opts.opponentTeamId,
    oppPack: opts.pack,
    config: opts.config,
  }).defenseIndexByFamily;
}
