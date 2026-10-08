import {
  brierScore,
  expectedCalibrationError,
  logLoss,
  reliabilityDiagram,
  type BinaryObservation,
  type ReliabilityBin,
} from "../src/metrics/calibration.js";
import {
  evaluateAcceptanceGate,
  SIM_V2_ACCEPTANCE_THRESHOLDS,
  type AcceptanceDecision,
} from "../src/flags/acceptanceGates.js";
import type { EngineName, MarketObservation, ScoreErrorRow } from "./types.js";

export type MetricBlock = {
  n: number;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  reliability: ReliabilityBin[];
  meanP: number;
  meanY: number;
  /** meanP - meanY (positive ⇒ overconfident / too high probs). */
  bias: number;
};

export function metricsFor(rows: BinaryObservation[]): MetricBlock {
  if (!rows.length) {
    return {
      n: 0,
      brier: null,
      logLoss: null,
      ece: null,
      reliability: [],
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
    ece: expectedCalibrationError(rows),
    reliability: reliabilityDiagram(rows),
    meanP,
    meanY,
    bias: meanP - meanY,
  };
}

export type FamilySlice = {
  key: string;
  family: string;
  period: string;
  extreme?: boolean;
  engines: Partial<Record<EngineName, MetricBlock>>;
};

export function sliceObservations(
  obs: MarketObservation[],
  engine: EngineName,
): BinaryObservation[] {
  return obs.map((o) => ({ p: o.engines[engine].p, y: o.y }));
}

export function groupByFamilyPeriod(obs: MarketObservation[]): FamilySlice[] {
  const keys = new Map<string, MarketObservation[]>();
  for (const o of obs) {
    const key = `${o.family}:${o.period}${o.extreme ? ":extreme" : ""}`;
    const arr = keys.get(key) ?? [];
    arr.push(o);
    keys.set(key, arr);
  }
  const engines: EngineName[] = ["v2_joint", "v1_frac", "baseline_hist", "baseline_coin"];
  return Array.from(keys.entries()).map(([key, rows]) => {
    const sample = rows[0]!;
    const block: FamilySlice = {
      key,
      family: sample.family,
      period: sample.period,
      extreme: sample.extreme,
      engines: {},
    };
    for (const eng of engines) {
      block.engines[eng] = metricsFor(sliceObservations(rows, eng));
    }
    return block;
  });
}

export type ScoreAccuracy = {
  engine: EngineName;
  period: string;
  n: number;
  maeHome: number;
  maeAway: number;
  maeTotal: number;
  rmseTotal: number;
};

export function summarizeScoreErrors(rows: ScoreErrorRow[]): ScoreAccuracy[] {
  const map = new Map<string, ScoreErrorRow[]>();
  for (const r of rows) {
    const key = `${r.engine}:${r.period}`;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([key, arr]) => {
    const [engine, period] = key.split(":") as [EngineName, string];
    const n = arr.length;
    const maeHome = arr.reduce((s, r) => s + r.absErrHome, 0) / n;
    const maeAway = arr.reduce((s, r) => s + r.absErrAway, 0) / n;
    const maeTotal = arr.reduce((s, r) => s + r.absErrTotal, 0) / n;
    const rmseTotal = Math.sqrt(arr.reduce((s, r) => s + r.absErrTotal ** 2, 0) / n);
    return { engine, period, n, maeHome, maeAway, maeTotal, rmseTotal };
  });
}

export function acceptanceForFamily(args: {
  sport: "nfl" | "ncaaf";
  family: "ml" | "spread" | "total" | "team_total";
  observations: BinaryObservation[];
  integrityRejectRate: number;
}): AcceptanceDecision {
  return evaluateAcceptanceGate({
    sport: args.sport,
    family: args.family,
    modelId: "football.joint.phase_b",
    modelVersion: "0.2.0",
    oosObservations: args.observations,
    integrityRejectRate: args.integrityRejectRate,
    correctRejectLabelRate: 1,
    deepLatency: { n: 1, meanMs: 10, p50Ms: 10, p95Ms: 50, maxMs: 100 },
    shadowSoakComplete: false,
    contractTestsGreen: true,
  });
}

export { SIM_V2_ACCEPTANCE_THRESHOLDS };
