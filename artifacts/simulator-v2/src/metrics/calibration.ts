export type BinaryObservation = {
  /** Predicted probability in [0,1]. */
  p: number;
  /** Outcome 1 = win, 0 = loss. */
  y: 0 | 1;
};

export function brierScore(rows: BinaryObservation[]): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const r of rows) {
    const d = r.p - r.y;
    sum += d * d;
  }
  return sum / rows.length;
}

export function logLoss(rows: BinaryObservation[], eps = 1e-15): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const r of rows) {
    const p = Math.min(1 - eps, Math.max(eps, r.p));
    sum += r.y === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / rows.length;
}

export type ReliabilityBin = {
  lo: number;
  hi: number;
  count: number;
  avgPred: number;
  avgOutcome: number;
};

export function reliabilityDiagram(rows: BinaryObservation[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const inBin = rows.filter((r) => (i === bins - 1 ? r.p >= lo && r.p <= hi : r.p >= lo && r.p < hi));
    if (inBin.length === 0) {
      out.push({ lo, hi, count: 0, avgPred: 0, avgOutcome: 0 });
      continue;
    }
    const avgPred = inBin.reduce((s, r) => s + r.p, 0) / inBin.length;
    const avgOutcome = inBin.reduce((s, r) => s + r.y, 0) / inBin.length;
    out.push({ lo, hi, count: inBin.length, avgPred, avgOutcome });
  }
  return out;
}

/** Expected Calibration Error. */
export function expectedCalibrationError(rows: BinaryObservation[], bins = 10): number | null {
  if (rows.length === 0) return null;
  const diagram = reliabilityDiagram(rows, bins);
  let ece = 0;
  for (const b of diagram) {
    if (b.count === 0) continue;
    ece += (b.count / rows.length) * Math.abs(b.avgPred - b.avgOutcome);
  }
  return ece;
}
