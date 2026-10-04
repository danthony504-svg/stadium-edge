/**
 * Rare count-prop probability model (HR, multi-goal, multi-SB, …).
 *
 * Empirically counting “games that cleared the line” makes Over 0.5 and Over 1.5
 * identical whenever the only productive game was a multi-count game (e.g. 2 HR).
 * A 0/N sample was also soft-floored to 2%, which +20000 American odds turned into
 * fake multi-hundred-percent EV.
 *
 * Instead: estimate a per-game mean λ from real logs, then evaluate the actual
 * threshold with a Poisson tail — P(X≥1) for Over 0.5, P(X≥2) for Over 1.5, etc.
 * No invented probability floor: zero mean / no evidence → null (ungradeable).
 */

export const RARE_COUNT_MIN_SAMPLE = 2;

/** Markets where multi-rung half-lines are rare count events (not high-volume yards). */
export function isRareCountPropMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!m) return false;
  if (/batter\s*home\s*runs?|home\s*runs?|\bhomer|\bhr\b/.test(m)) return true;
  if (/batter\s*stolen\s*bases?|stolen\s*bases?/.test(m)) return true;
  if (/player\s*goals|\bgoals?\b/.test(m) && !/field|scorer|shot|against/.test(m)) return true;
  return false;
}

/**
 * Integer count required to clear an Over half-line.
 * Over 0.5 → ≥1, Over 1.5 → ≥2, Over 2.5 → ≥3.
 */
export function rareCountThresholdK(line: number): number {
  if (!Number.isFinite(line)) return 1;
  return Math.max(1, Math.ceil(line));
}

/** Poisson P(X ≥ k) for λ ≥ 0. */
export function poissonPAtLeast(lambda: number, k: number): number {
  if (!Number.isFinite(lambda) || lambda < 0) return 0;
  if (k <= 0) return 1;
  if (lambda === 0) return 0;
  // 1 - sum_{i=0}^{k-1} e^{-λ} λ^i / i!
  let term = Math.exp(-lambda); // i = 0
  let sum = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    sum += term;
  }
  const p = 1 - sum;
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function meanCount(vals: number[]): number {
  if (!vals.length) return 0;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

/**
 * Threshold-aware hit probability from real per-game counts.
 * Returns null when evidence cannot support a probability (never invents 2%).
 */
export function rareCountHitFromValues(
  vals: number[],
  line: number,
  side: "Over" | "Under",
): number | null {
  if (vals.length < RARE_COUNT_MIN_SAMPLE) return null;
  if (!Number.isFinite(line)) return null;
  const lambda = meanCount(vals);
  const k = rareCountThresholdK(line);

  if (side === "Over") {
    // No observed production → cannot defend any Over probability.
    if (lambda <= 0) return null;
    const p = poissonPAtLeast(lambda, k);
    if (p <= 0) return null;
    // Soft-cap only pure certainty — never invent a floor on zeros.
    return p >= 0.999 ? 0.98 : p;
  }

  // Under: P(X < line) ≡ P(X ≤ k-1) = 1 - P(X ≥ k)
  if (lambda <= 0) {
    // Always under when the player never records the stat.
    return 0.98;
  }
  const pOver = poissonPAtLeast(lambda, k);
  const p = 1 - pOver;
  if (p <= 0) return null;
  return p >= 0.999 ? 0.98 : p;
}

/**
 * Reliability 0..1 for ranking — small samples / thin threshold evidence
 * must not let raw EV dominate ordinary high-volume props.
 */
export function rareCountHitReliability(
  vals: number[],
  line: number,
  side: "Over" | "Under",
): number {
  const n = vals.length;
  if (n < RARE_COUNT_MIN_SAMPLE) return 0;
  const k = rareCountThresholdK(line);
  const lambda = meanCount(vals);
  const thresholdHits = vals.filter((v) =>
    side === "Under" ? v < line : v >= line,
  ).length;
  // Sample-size factor: n=15 → 1.0, n=2 → ~0.13
  const nFactor = Math.min(1, n / 15);
  let evidence = 1;
  if (side === "Over" && k >= 2) {
    // Multi-count Overs need real threshold support or a meaningful rate.
    const support = thresholdHits + lambda * n * 0.15;
    evidence = Math.min(1, support / Math.max(3, k + 1));
  } else if (side === "Over" && k === 1) {
    evidence = Math.min(1, (thresholdHits + 1) / 4);
  }
  const r = nFactor * evidence;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/** True when this prop line is a rare multi-count Over (HR 1.5+, goals 1.5+, …). */
export function isRareMultiCountOver(opts: {
  market?: string | null;
  line?: number | null;
  side?: string | null;
}): boolean {
  if (!isRareCountPropMarket(opts.market)) return false;
  const side = String(opts.side ?? "").toLowerCase();
  if (side && side !== "over" && side !== "yes") return false;
  const line = opts.line;
  if (line == null || !Number.isFinite(line)) return false;
  return rareCountThresholdK(line) >= 2;
}

/**
 * Canonical rare-market family key for same-event diversity
 * (batter_home_runs / batter_home_runs_alternate → batter_home_runs).
 */
export function rareCountFamilyKey(market: string | null | undefined): string {
  return String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Same-game rare family seat key — caps HR/SB/goals stacks on generic tickets.
 */
export function rareCountGameFamilyKey(opts: {
  game?: string | null;
  market?: string | null;
}): string | null {
  if (!isRareCountPropMarket(opts.market)) return null;
  const fam = rareCountFamilyKey(opts.market);
  if (!fam) return null;
  return `${String(opts.game ?? "").toLowerCase()}|${fam}`;
}

/**
 * Ranking weight for EV: weak rare-count evidence cannot dominate ordinary props.
 * Non-rare / full reliability → 1. Reliability 0 → near-zero EV influence.
 */
export function rareCountEvRankWeight(reliability: number | null | undefined): number {
  const r =
    reliability == null || !Number.isFinite(reliability)
      ? 1
      : Math.max(0, Math.min(1, reliability));
  // Square so thin multi-count Overs (r≈0.3) keep ~9% of raw EV in the sort key.
  return 0.05 + 0.95 * r * r;
}
