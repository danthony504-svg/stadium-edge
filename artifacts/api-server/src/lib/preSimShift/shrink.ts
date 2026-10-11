import { PRE_SIM_SHIFT_CAPS } from "./types.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function meanFinite(vals: readonly number[]): number | null {
  let s = 0;
  let n = 0;
  for (const v of vals) {
    if (Number.isFinite(v)) {
      s += v;
      n += 1;
    }
  }
  return n > 0 ? s / n : null;
}

/**
 * Bayesian shrinkage of a raw ratio toward 1.0:
 *   shrunk = (n * raw + n0 * 1) / (n + n0)
 * Small samples → near 1.0; large samples → near raw.
 */
export function shrinkRatioToOne(
  raw: number,
  sample: number,
  priorGames: number = PRE_SIM_SHIFT_CAPS.shrinkPriorGames,
): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const n = Math.max(0, sample);
  const n0 = Math.max(0, priorGames);
  if (n + n0 <= 0) return 1;
  return (n * raw + n0 * 1) / (n + n0);
}

export function cappedRatio(
  raw: number,
  sample: number,
  lo: number,
  hi: number,
  minSample: number = PRE_SIM_SHIFT_CAPS.minSample,
): { factor: number; sample: number } {
  if (sample < minSample) return { factor: 1, sample };
  const shrunk = shrinkRatioToOne(raw, sample);
  return { factor: clamp(shrunk, lo, hi), sample };
}

/** Safe positive ratio a/b; null when undefined. */
export function safeRatio(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 1e-9
  ) {
    return null;
  }
  return numerator / denominator;
}
