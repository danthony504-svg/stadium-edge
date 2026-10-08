/**
 * Shared family-level calibration reporting for Simulator V2 chrono OOS.
 * Train/val may inform diagnostics; final holdout is never used for tuning.
 * Closing-line benchmarks require licensed sources — absent → INSUFFICIENT_DATA.
 */
import {
  brierScore,
  expectedCalibrationError,
  logLoss,
  reliabilityDiagram,
  type BinaryObservation,
} from "../src/metrics/calibration.js";
import { SIM_V2_ACCEPTANCE_THRESHOLDS } from "../src/flags/acceptanceGates.js";
import { createSeededRng } from "../src/seed/mulberry32.js";

export type FamilyVerdict = "PASS" | "FAIL" | "INSUFFICIENT_DATA";

export type CalibObs = BinaryObservation & {
  eventId: string;
  /** Sport:family key fragment, e.g. ml | spread | total | player_prop */
  family: string;
  /** Fine slice, e.g. ml_home | pass_yds | alt_total */
  slice: string;
  fold: "train" | "val" | "holdout";
  isAlt?: boolean;
  playerId?: string;
  line?: number;
  /** Named-player grounding flags */
  namedPlayer?: boolean;
  participationKnown?: boolean;
  realBookLine?: boolean;
};

export type FamilyGateRow = {
  key: string;
  verdict: FamilyVerdict;
  n: number;
  nGames: number;
  nPlayers: number;
  effectiveN: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  eceSe: number | null;
  meanP: number;
  meanY: number;
  bias: number;
  reasons: string[];
  overconf80: { n: number; hitRate: number | null };
  overconf90: { n: number; hitRate: number | null };
  overconf95: { n: number; hitRate: number | null };
};

export type DistCompare = {
  label: string;
  n: number;
  actualMean: number;
  simMean: number;
  actualVar: number;
  simVar: number;
  actualP90: number;
  simP90: number;
  meanError: number;
  varRatio: number;
};

function uniqCount(vals: string[]): number {
  return new Set(vals).size;
}

/** Kish effective sample size from game cluster sizes. */
export function effectiveSampleSize(eventIds: string[]): number {
  const counts = new Map<string, number>();
  for (const id of eventIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const sizes = [...counts.values()];
  if (!sizes.length) return 0;
  const sum = sizes.reduce((a, b) => a + b, 0);
  const sumSq = sizes.reduce((a, b) => a + b * b, 0);
  return sumSq > 0 ? (sum * sum) / sumSq : 0;
}

export function metricsOf(rows: BinaryObservation[]) {
  if (!rows.length) {
    return {
      n: 0,
      brier: null as number | null,
      logLoss: null as number | null,
      ece: null as number | null,
      meanP: 0,
      meanY: 0,
      bias: 0,
    };
  }
  const meanP = rows.reduce((s, r) => s + r.p, 0) / rows.length;
  const meanY = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  return {
    n: rows.length,
    brier: brierScore(rows),
    logLoss: logLoss(rows),
    ece: expectedCalibrationError(rows, 10),
    meanP,
    meanY,
    bias: meanP - meanY,
  };
}

export function overconfidenceBand(rows: BinaryObservation[], threshold: number) {
  const band = rows.filter((r) => r.p >= threshold);
  if (!band.length) return { n: 0, hitRate: null as number | null };
  return { n: band.length, hitRate: band.reduce((s, r) => s + r.y, 0) / band.length };
}

/** Mean |p − 0.5|; collapses toward 0 when probs shrink to a coin-flip. */
export function meanAbsDevFromHalf(rows: BinaryObservation[]): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + Math.abs(r.p - 0.5), 0) / rows.length;
}

/**
 * Discrimination proxies: mean predicted P when y=1 vs y=0 (separation).
 * Positive separation ⇒ model ranks wins higher than losses on average.
 */
export function separationByOutcome(rows: BinaryObservation[]): {
  meanPWhenY1: number | null;
  meanPWhenY0: number | null;
  separation: number | null;
  nY1: number;
  nY0: number;
} {
  const y1 = rows.filter((r) => r.y === 1);
  const y0 = rows.filter((r) => r.y === 0);
  const meanPWhenY1 = y1.length ? y1.reduce((s, r) => s + r.p, 0) / y1.length : null;
  const meanPWhenY0 = y0.length ? y0.reduce((s, r) => s + r.p, 0) / y0.length : null;
  const separation =
    meanPWhenY1 != null && meanPWhenY0 != null ? meanPWhenY1 - meanPWhenY0 : null;
  return { meanPWhenY1, meanPWhenY0, separation, nY1: y1.length, nY0: y0.length };
}

/**
 * Mann–Whitney AUC (probability that a random y=1 has higher p than a random y=0).
 * Ties contribute 0.5. Returns null if a class is empty.
 */
export function binaryAuc(rows: BinaryObservation[]): number | null {
  const pos = rows.filter((r) => r.y === 1).map((r) => r.p);
  const neg = rows.filter((r) => r.y === 0).map((r) => r.p);
  if (!pos.length || !neg.length) return null;
  let rankSum = 0;
  for (const p of pos) {
    for (const q of neg) {
      if (p > q) rankSum += 1;
      else if (p === q) rankSum += 0.5;
    }
  }
  return rankSum / (pos.length * neg.length);
}

/**
 * Murphy resolution component of Brier decomposition (higher ⇒ more discrimination).
 * resolution = (1/n) Σ_k n_k (ȳ_k − ȳ)² over equal-width probability bins.
 */
export function brierResolution(rows: BinaryObservation[], bins = 10): number | null {
  if (rows.length < 10) return null;
  const yBar = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const diagram = reliabilityDiagram(rows, bins);
  let res = 0;
  for (const b of diagram) {
    if (!b.count) continue;
    res += (b.count / rows.length) * (b.avgOutcome - yBar) ** 2;
  }
  return res;
}

/** Prefer AUC; fall back to Brier resolution when AUC is undefined / degenerate. */
export function discriminationProxy(rows: BinaryObservation[]): {
  kind: "auc" | "resolution" | "none";
  value: number | null;
  auc: number | null;
  resolution: number | null;
  separation: number | null;
  meanPWhenY1: number | null;
  meanPWhenY0: number | null;
} {
  const sep = separationByOutcome(rows);
  const auc = binaryAuc(rows);
  const resolution = brierResolution(rows);
  if (auc != null && Number.isFinite(auc) && sep.nY1 >= 5 && sep.nY0 >= 5) {
    return {
      kind: "auc",
      value: auc,
      auc,
      resolution,
      separation: sep.separation,
      meanPWhenY1: sep.meanPWhenY1,
      meanPWhenY0: sep.meanPWhenY0,
    };
  }
  if (resolution != null) {
    return {
      kind: "resolution",
      value: resolution,
      auc,
      resolution,
      separation: sep.separation,
      meanPWhenY1: sep.meanPWhenY1,
      meanPWhenY0: sep.meanPWhenY0,
    };
  }
  return {
    kind: "none",
    value: null,
    auc,
    resolution,
    separation: sep.separation,
    meanPWhenY1: sep.meanPWhenY1,
    meanPWhenY0: sep.meanPWhenY0,
  };
}

/**
 * Flag ECE gains driven mainly by collapse of |p−0.5| toward 0.5 (shrink-to-50).
 * Thresholds match MLB A/B holdout diagnosis.
 */
export function shrinkTo50Flag(opts: {
  eceBefore: number | null;
  eceAfter: number | null;
  madBefore: number;
  madAfter: number;
}): { flagged: boolean; note: string; madDropPct: number; deltaEce: number | null } {
  const { eceBefore, eceAfter, madBefore, madAfter } = opts;
  if (eceBefore == null || eceAfter == null) {
    return { flagged: false, note: "insufficient_ece", madDropPct: 0, deltaEce: null };
  }
  const deltaEce = eceAfter - eceBefore;
  const madDrop = madBefore - madAfter;
  const madDropPct = madBefore > 1e-9 ? madDrop / madBefore : 0;
  const eceImproved = deltaEce < -0.005;
  const madCollapsed = madDropPct >= 0.25 && madDrop >= 0.02;
  const flagged = eceImproved && madCollapsed;
  const note = flagged
    ? `SHRINK_TO_50_SUSPECT: ΔECE=${deltaEce.toFixed(4)} but meanAbsDevFromHalf ${madBefore.toFixed(4)}→${madAfter.toFixed(4)} (drop ${(madDropPct * 100).toFixed(1)}%) — ECE gain may be from probs collapsing toward 0.5`
    : `ok: ΔECE=${deltaEce.toFixed(4)}, meanAbsDevFromHalf ${madBefore.toFixed(4)}→${madAfter.toFixed(4)} (Δ=${(madAfter - madBefore).toFixed(4)}, ${(madDropPct * 100).toFixed(1)}% drop)`;
  return { flagged, note, madDropPct, deltaEce };
}

/** Game-clustered bootstrap SE for ECE. */
export function clusteredEceSe(obs: CalibObs[], nBoot = 200, seed = "ece-boot"): number | null {
  if (obs.length < 20) return null;
  const byGame = new Map<string, CalibObs[]>();
  for (const o of obs) {
    const arr = byGame.get(o.eventId) ?? [];
    arr.push(o);
    byGame.set(o.eventId, arr);
  }
  const gameIds = [...byGame.keys()];
  if (gameIds.length < 8) return null;
  const { next } = createSeededRng(seed);
  const eces: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const sample: BinaryObservation[] = [];
    for (let i = 0; i < gameIds.length; i++) {
      const g = gameIds[Math.floor(next() * gameIds.length)]!;
      for (const row of byGame.get(g) ?? []) sample.push({ y: row.y, p: row.p });
    }
    const e = expectedCalibrationError(sample, 10);
    if (e != null) eces.push(e);
  }
  if (!eces.length) return null;
  const mean = eces.reduce((a, b) => a + b, 0) / eces.length;
  const var_ = eces.reduce((a, b) => a + (b - mean) ** 2, 0) / eces.length;
  return Math.sqrt(var_);
}

export function evaluateFamilyGate(
  key: string,
  rows: CalibObs[],
  opts?: { requireNamedPlayer?: boolean; requireRealBook?: boolean },
): FamilyGateRow {
  const reasons: string[] = [];
  const m = metricsOf(rows);
  const nGames = uniqCount(rows.map((r) => r.eventId));
  const nPlayers = uniqCount(rows.map((r) => r.playerId).filter((x): x is string => !!x));
  const eff = effectiveSampleSize(rows.map((r) => r.eventId));
  const eceSe = clusteredEceSe(rows, 200, `ece:${key}`);

  if (opts?.requireNamedPlayer && rows.some((r) => !r.namedPlayer)) {
    reasons.push("named_player_grounding_incomplete");
  }
  if (opts?.requireRealBook && rows.some((r) => !r.realBookLine)) {
    reasons.push("closing_line_unavailable_unlicensed");
  }
  if (m.n < SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample) {
    reasons.push(`oos_sample_${m.n}_lt_${SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample}`);
  }
  if (m.ece == null || m.ece > SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce) {
    reasons.push(`ece_${m.ece?.toFixed(4) ?? "null"}_gt_${SIM_V2_ACCEPTANCE_THRESHOLDS.maxEce}`);
  }

  let verdict: FamilyVerdict = "PASS";
  if (reasons.some((r) => r.startsWith("closing_line") || r.startsWith("named_player"))) {
    // Data-quality blockers dominate when sample would otherwise be judged.
    verdict = m.n < SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample ? "INSUFFICIENT_DATA" : "FAIL";
  } else if (m.n < SIM_V2_ACCEPTANCE_THRESHOLDS.minOosSample) {
    verdict = "INSUFFICIENT_DATA";
  } else if (reasons.length) {
    verdict = "FAIL";
  }

  // Extreme-prob overconfidence always recorded; if hit rate << threshold → FAIL reason.
  const o80 = overconfidenceBand(rows, 0.8);
  const o90 = overconfidenceBand(rows, 0.9);
  const o95 = overconfidenceBand(rows, 0.95);
  if (o90.n >= 20 && o90.hitRate != null && o90.hitRate < 0.8) {
    reasons.push(`overconfident_p90_hit_${o90.hitRate.toFixed(3)}_n_${o90.n}`);
    if (verdict === "PASS") verdict = "FAIL";
  }
  if (o95.n >= 10 && o95.hitRate != null && o95.hitRate < 0.85) {
    reasons.push(`overconfident_p95_hit_${o95.hitRate.toFixed(3)}_n_${o95.n}`);
    if (verdict === "PASS") verdict = "FAIL";
  }

  return {
    key,
    verdict,
    n: m.n,
    nGames,
    nPlayers,
    effectiveN: eff,
    brier: m.brier,
    logLoss: m.logLoss,
    ece: m.ece,
    eceSe,
    meanP: m.meanP,
    meanY: m.meanY,
    bias: m.bias,
    reasons,
    overconf80: o80,
    overconf90: o90,
    overconf95: o95,
  };
}

export function compareDistributions(
  label: string,
  actual: number[],
  simulatedMeans: number[],
): DistCompare | null {
  if (actual.length < 5 || simulatedMeans.length < 5) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = (xs: number[]) => {
    const m = mean(xs);
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  };
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
    return s[i]!;
  };
  const am = mean(actual);
  const sm = mean(simulatedMeans);
  const av = variance(actual);
  const sv = variance(simulatedMeans);
  return {
    label,
    n: actual.length,
    actualMean: am,
    simMean: sm,
    actualVar: av,
    simVar: sv,
    actualP90: pct(actual, 0.9),
    simP90: pct(simulatedMeans, 0.9),
    meanError: sm - am,
    varRatio: av > 1e-9 ? sv / av : NaN,
  };
}

export function formatGateTable(rows: FamilyGateRow[]): string[] {
  const lines = [
    `| Family | Verdict | n | games | effN | Brier | LogLoss | ECE | ECE_SE | bias | reasons |`,
    `|--------|---------|---|-------|------|-------|---------|-----|--------|------|---------|`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.key} | **${r.verdict}** | ${r.n} | ${r.nGames} | ${r.effectiveN.toFixed(1)} | ${r.brier?.toFixed(4) ?? "n/a"} | ${r.logLoss?.toFixed(4) ?? "n/a"} | ${r.ece?.toFixed(4) ?? "n/a"} | ${r.eceSe?.toFixed(4) ?? "n/a"} | ${r.bias.toFixed(3)} | ${r.reasons.join("; ") || "—"} |`,
    );
  }
  return lines;
}

export function formatReliability(rows: BinaryObservation[], bins = 10): string[] {
  const diag = reliabilityDiagram(rows, bins);
  const lines = [
    `| bin | n | avgPred | avgY | gap |`,
    `|-----|---|---------|------|-----|`,
  ];
  for (const b of diag) {
    if (!b.count) continue;
    lines.push(
      `| ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} | ${b.count} | ${b.avgPred.toFixed(3)} | ${b.avgOutcome.toFixed(3)} | ${(b.avgPred - b.avgOutcome).toFixed(3)} |`,
    );
  }
  return lines;
}

export function formatDistTable(rows: DistCompare[]): string[] {
  const lines = [
    `| Dist | n | actMean | simMean | err | actVar | simVar | varRatio | actP90 | simP90 |`,
    `|------|---|---------|---------|-----|--------|--------|----------|--------|--------|`,
  ];
  for (const d of rows) {
    lines.push(
      `| ${d.label} | ${d.n} | ${d.actualMean.toFixed(2)} | ${d.simMean.toFixed(2)} | ${d.meanError.toFixed(2)} | ${d.actualVar.toFixed(2)} | ${d.simVar.toFixed(2)} | ${Number.isFinite(d.varRatio) ? d.varRatio.toFixed(2) : "n/a"} | ${d.actualP90.toFixed(1)} | ${d.simP90.toFixed(1)} |`,
    );
  }
  return lines;
}
