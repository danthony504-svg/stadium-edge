/**
 * Anytime TD probability model (NFL / NCAAF `player_anytime_td`).
 *
 * Anytime TD is P(at least one TD) — not mean TD count, not rushing/receiving
 * volume, and not “multi-TD games count as multiple hits.”
 *
 * Per-game TD counts from ESPN are converted to binary scoring events
 * (scored / did not). Thin samples shrink toward a league prior. There is no
 * invented 2% floor that manufactures +EV at long American odds.
 *
 * Large disagreements vs sportsbook implied probability require stronger
 * sample reliability before normal Coach may seat the leg.
 */

import { impliedProb } from "./format.ts";

export const ANYTIME_TD_MIN_SAMPLE = 2;
/** Games of prior weight in the Beta/binomial shrink. */
export const ANYTIME_TD_PRIOR_STRENGTH = 4;
/** League skill-player anytime prior (~18%). */
export const ANYTIME_TD_PRIOR_MEAN = 0.18;
/** Soft ceiling — never emit manufactured certainty. */
export const ANYTIME_TD_SOFT_CAP = 0.95;
/** Min reliability to seat when sim ≫ implied. */
export const ANYTIME_TD_EXTREME_MIN_RELIABILITY = 0.65;
/** sim/implied above this (or gap) is “extreme” without strong evidence. */
export const ANYTIME_TD_EXTREME_RATIO = 2.0;
export const ANYTIME_TD_EXTREME_GAP = 0.15;
/**
 * Opportunity-style multiplicative bump cap on local hit rates when there is
 * no red-zone / goal-line support already loaded on the pick context.
 */
export const ANYTIME_TD_OPP_BUMP_NO_RZ_CAP = 0.06;
export const ANYTIME_TD_OPP_BUMP_WITH_RZ_CAP = 0.12;

export function isAnytimeTdPropMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_alternate$/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!m) return false;
  if (m === "player anytime td" || m === "anytime td") return true;
  if (/anytime\s*td|anytime\s*touchdown/.test(m)) return true;
  // Bare "touchdown" without pass/rush/rec qualifier → anytime family.
  if (/\btouchdown\b/.test(m) && !/pass|rush|rec|reception|first/.test(m)) {
    return true;
  }
  return false;
}

/** Binary scoring indicator: 1 if the player scored ≥1 TD in the game. */
export function anytimeTdScoredIndicator(tdCount: number): 0 | 1 {
  if (!Number.isFinite(tdCount) || tdCount < 1) return 0;
  return 1;
}

export function anytimeTdBinarySeries(vals: number[]): number[] {
  return vals.filter((v) => Number.isFinite(v)).map((v) => anytimeTdScoredIndicator(v));
}

/**
 * Mean TD count λ → Poisson P(X ≥ 1) = 1 − e^{−λ}.
 * Kept for diagnostics / conversion proof. Coach Anytime TD seating uses the
 * binary scoring frequency (multi-TD games must not inflate the rate).
 */
export function poissonPAtLeastOneFromLambda(lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  const p = 1 - Math.exp(-lambda);
  if (!Number.isFinite(p)) return 0;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Lambda that yields P(X ≥ 1) = p under Poisson: λ = −ln(1 − p).
 * Ground λ in the shrunk scoring frequency, not raw TD-count mean.
 */
export function poissonLambdaFromPAtLeastOne(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p >= 1) return 8;
  return -Math.log(1 - Math.min(0.999, p));
}

export type AnytimeTdHitResult = {
  hit: number | null;
  reliability: number;
  /** Games with ≥1 TD / n — empirical scoring frequency before shrink. */
  rawScoreRate: number;
  scoreHits: number;
  sampleGames: number;
  /** Count-mean λ (diagnostic only — not used for seating probability). */
  countMeanLambda: number;
  /** Poisson P(X≥1) from count mean (shows multi-TD inflation vs binary). */
  poissonFromCountMean: number;
};

/**
 * Anytime TD hit probability from per-game TD counts.
 * Uses binary scoring frequency + Bayesian shrink — never a 2% floor.
 */
export function anytimeTdHitFromValues(
  vals: number[],
  side: "Over" | "Under" = "Over",
): AnytimeTdHitResult {
  const finite = vals.filter((v) => Number.isFinite(v));
  const binary = anytimeTdBinarySeries(finite);
  const n = binary.length;
  const empty: AnytimeTdHitResult = {
    hit: null,
    reliability: 0,
    rawScoreRate: 0,
    scoreHits: 0,
    sampleGames: n,
    countMeanLambda: 0,
    poissonFromCountMean: 0,
  };
  if (n < ANYTIME_TD_MIN_SAMPLE) return empty;

  const scoreHits = binary.reduce((a, b) => a + b, 0);
  const rawScoreRate = scoreHits / n;
  const countMeanLambda =
    finite.reduce((a, b) => a + b, 0) / Math.max(1, finite.length);
  const poissonFromCountMean = poissonPAtLeastOneFromLambda(countMeanLambda);

  // Beta-binomial shrink toward league prior.
  const alpha = ANYTIME_TD_PRIOR_STRENGTH * ANYTIME_TD_PRIOR_MEAN;
  const beta = ANYTIME_TD_PRIOR_STRENGTH * (1 - ANYTIME_TD_PRIOR_MEAN);
  const shrunk = (scoreHits + alpha) / (n + alpha + beta);

  const reliability = anytimeTdHitReliability(n, scoreHits);

  if (side === "Under") {
    const pUnder = 1 - shrunk;
    return {
      hit: pUnder >= 0.999 ? ANYTIME_TD_SOFT_CAP : pUnder,
      reliability,
      rawScoreRate,
      scoreHits,
      sampleGames: n,
      countMeanLambda,
      poissonFromCountMean,
    };
  }

  // Over / Yes — no invented floor. Prior keeps zeros gradeable but low-reliability.
  const hit = shrunk >= 0.999 ? ANYTIME_TD_SOFT_CAP : shrunk;
  return {
    hit,
    reliability,
    rawScoreRate,
    scoreHits,
    sampleGames: n,
    countMeanLambda,
    poissonFromCountMean,
  };
}

/**
 * Sample-size reliability 0..1.
 * 0/5 and 1/5 stay weak; perfect small samples are not full trust.
 */
export function anytimeTdHitReliability(sampleGames: number, scoreHits: number): number {
  if (sampleGames < ANYTIME_TD_MIN_SAMPLE) return 0;
  const nFactor = Math.min(1, sampleGames / 10);
  // Evidence grows with scoring games observed; zeros stay soft.
  const evidence =
    scoreHits <= 0
      ? 0.35
      : Math.min(1, (scoreHits + 0.5) / 4);
  const r = nFactor * evidence;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Cap an opportunity-style multiplicative bump on a TD hit rate.
 * Without red-zone / goal-line support, backups cannot jump to elite TD rates.
 */
export function capAnytimeTdOpportunityBump(
  baseHit: number,
  bumpMult: number,
  opts?: { hasRedZoneSupport?: boolean | null },
): number {
  if (!Number.isFinite(baseHit) || baseHit <= 0) return baseHit;
  if (!Number.isFinite(bumpMult) || bumpMult === 1) return baseHit;
  const hasRz = !!opts?.hasRedZoneSupport;
  const maxBump = hasRz ? ANYTIME_TD_OPP_BUMP_WITH_RZ_CAP : ANYTIME_TD_OPP_BUMP_NO_RZ_CAP;
  const cappedMult = Math.max(1 - maxBump, Math.min(1 + maxBump, bumpMult));
  const out = baseHit * cappedMult;
  return Math.max(0.01, Math.min(ANYTIME_TD_SOFT_CAP, out));
}

/**
 * Extreme market disagreement needs stronger grounding before normal Coach seats.
 * Does not auto-reject the model estimate — only seating eligibility.
 */
export function anytimeTdMarketDisagreementExtreme(
  simHit: number | null | undefined,
  odds: number | null | undefined,
): boolean {
  if (simHit == null || !Number.isFinite(simHit) || odds == null || !Number.isFinite(odds)) {
    return false;
  }
  const implied = impliedProb(odds);
  if (!(implied > 0) || !(implied < 1)) return false;
  const ratio = simHit / implied;
  const gap = simHit - implied;
  return ratio >= ANYTIME_TD_EXTREME_RATIO || gap >= ANYTIME_TD_EXTREME_GAP;
}

/**
 * Blend sim toward implied when disagreement is extreme and evidence is thin.
 * Strong reliability keeps more of the model estimate.
 */
export function anytimeTdCalibrateToMarket(
  simHit: number,
  odds: number | null | undefined,
  reliability: number,
): number {
  if (!Number.isFinite(simHit) || odds == null || !Number.isFinite(odds)) return simHit;
  if (!anytimeTdMarketDisagreementExtreme(simHit, odds)) return simHit;
  const implied = impliedProb(odds);
  const r = Math.max(0, Math.min(1, reliability));
  // Thin evidence → mostly market; strong evidence keeps more model.
  const modelWeight = 0.25 + 0.55 * r;
  const calibrated = implied + (simHit - implied) * modelWeight;
  return Math.max(0.01, Math.min(ANYTIME_TD_SOFT_CAP, calibrated));
}

export type AnytimeTdSeatAllowOpts = {
  hitReliability?: number | null;
  odds?: number | null;
  simHit?: number | null;
  /** Explicit TD / touchdown market lock asks still need qualify floors. */
  explicitTdAsk?: boolean | null;
};

/**
 * Normal Coach seating eligibility for Anytime TD.
 * Positive EV alone never opens extreme longshot TD seats — when sim ≫ implied,
 * require strong sample reliability. Mild cases still need #711 qualify floors.
 */
export function anytimeTdNormalSeatAllowed(
  pick: {
    propMarketKey?: string | null;
    market?: string | null;
    isProp?: boolean | null;
    odds?: number | null;
  },
  opts: AnytimeTdSeatAllowOpts = {},
): boolean {
  if (!pick.isProp) return true;
  const market = pick.propMarketKey ?? pick.market;
  if (!isAnytimeTdPropMarket(market)) return true;

  const rel = opts.hitReliability;
  const simHit = opts.simHit;
  const odds = opts.odds ?? pick.odds ?? null;

  // Explicitly weak reliability → fail closed.
  if (rel != null && Number.isFinite(rel) && rel < 0.35) return false;

  if (anytimeTdMarketDisagreementExtreme(simHit, odds)) {
    // Extreme disagreement: missing or thin reliability cannot seat via EV alone.
    if (rel == null || !Number.isFinite(rel)) return false;
    return rel >= ANYTIME_TD_EXTREME_MIN_RELIABILITY;
  }
  return true;
}
