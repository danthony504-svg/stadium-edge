export type LatencyStats = {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  meanMs: number | null;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeLatency(samplesMs: number[]): LatencyStats {
  const clean = samplesMs.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (clean.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null, maxMs: null, meanMs: null };
  }
  const meanMs = clean.reduce((s, n) => s + n, 0) / clean.length;
  return {
    count: clean.length,
    p50Ms: percentile(clean, 50),
    p95Ms: percentile(clean, 95),
    maxMs: clean[clean.length - 1],
    meanMs,
  };
}
