/**
 * Anytime TD probability helpers shared by the server Monte Carlo path.
 * Mirror of stadium-mobile/lib/anytimeTdPropModel.ts — keep formulas aligned.
 *
 * Anytime TD = P(at least one TD), estimated from binary scoring frequency
 * (game scored / did not), not from mean TD count (multi-TD games must not
 * inflate the rate).
 */

export const ANYTIME_TD_PRIOR_STRENGTH = 4;
export const ANYTIME_TD_PRIOR_MEAN = 0.18;
export const ANYTIME_TD_MIN_SAMPLE = 3; // server MC already requires n≥3
/** Family opportunity multiplier caps (tighter than generic 1.22). */
export const ANYTIME_TD_OPP_MAX_WITH_RZ = 1.1;
export const ANYTIME_TD_OPP_MAX_NO_RZ = 1.06;

export function isAnytimeTdMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!m) return false;
  if (m === "player anytime td" || m === "anytime td") return true;
  if (/anytime\s*td|anytime\s*touchdown/.test(m)) return true;
  if (/\btouchdown\b/.test(m) && !/pass|rush|rec|reception|first/.test(m)) {
    return true;
  }
  return false;
}

export function anytimeTdBinarySeries(vals: number[]): number[] {
  return vals
    .filter((v) => Number.isFinite(v))
    .map((v) => (v >= 1 ? 1 : 0));
}

/** Shrunk P(score ≥ 1) from per-game TD counts. */
export function anytimeTdShrunkScoreRate(vals: number[]): number | null {
  const binary = anytimeTdBinarySeries(vals);
  const n = binary.length;
  if (n < ANYTIME_TD_MIN_SAMPLE) return null;
  const hits = binary.reduce((a, b) => a + b, 0);
  const alpha = ANYTIME_TD_PRIOR_STRENGTH * ANYTIME_TD_PRIOR_MEAN;
  const beta = ANYTIME_TD_PRIOR_STRENGTH * (1 - ANYTIME_TD_PRIOR_MEAN);
  return (hits + alpha) / (n + alpha + beta);
}

/**
 * Poisson λ such that P(X ≥ 1) = p: λ = −ln(1 − p).
 * Grounded in shrunk scoring frequency — not raw TD-count mean.
 */
export function poissonLambdaForAnytimeTd(pScore: number): number {
  if (!Number.isFinite(pScore) || pScore <= 0) return 0;
  if (pScore >= 0.999) return 8;
  return -Math.log(1 - Math.min(0.999, pScore));
}

/**
 * Cap opportunity family multiplier for anytime_td.
 * Without red-zone / goal-line channel contributions, keep the bump tiny so a
 * backup cannot become a 70%+ TD candidate from carry volume alone.
 */
export function capAnytimeTdOpportunityMult(
  mult: number | null | undefined,
  opts?: { hasRedZoneChannel?: boolean | null },
): number {
  if (mult == null || !Number.isFinite(mult) || mult <= 0) return 1;
  const max = opts?.hasRedZoneChannel
    ? ANYTIME_TD_OPP_MAX_WITH_RZ
    : ANYTIME_TD_OPP_MAX_NO_RZ;
  const min = 2 - max; // symmetric floor around 1
  return Math.max(min, Math.min(max, mult));
}

export function contributionsHaveRedZone(
  contributions: readonly { channel?: string | null }[] | null | undefined,
): boolean {
  if (!contributions?.length) return false;
  return contributions.some((c) => {
    const ch = String(c.channel ?? "");
    return ch === "rz_carries" || ch === "gl_carries";
  });
}
