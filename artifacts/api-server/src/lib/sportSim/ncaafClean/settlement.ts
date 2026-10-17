/**
 * Settlement helpers for clean engine markets.
 * ML: OT-inclusive two-way; exclude tied/invalid historical finals (no half-wins).
 * ATS: Phase-E convention — home covers if homeScore + line > awayScore; push adj==0 excluded.
 */

export type MlSettlement =
  | { ok: true; yHomeWin: 0 | 1 }
  | { ok: false; reason: "tied_final" | "invalid_final" };

export type AtsSettlement =
  | { ok: true; yHomeCover: 0 | 1 }
  | { ok: false; reason: "push" | "invalid_final" };

export type TotalSettlement =
  | { ok: true; yOver: 0 | 1 }
  | { ok: false; reason: "push" | "invalid_final" };

/** Two-way moneyline settlement including OT finals; ties excluded. */
export function settleMoneyline(opts: {
  homeScore: number;
  awayScore: number;
  decided?: boolean;
}): MlSettlement {
  if (opts.decided === false) {
    return { ok: false, reason: "invalid_final" };
  }
  if (!Number.isFinite(opts.homeScore) || !Number.isFinite(opts.awayScore)) {
    return { ok: false, reason: "invalid_final" };
  }
  if (opts.homeScore === opts.awayScore) {
    return { ok: false, reason: "tied_final" };
  }
  return {
    ok: true,
    yHomeWin: opts.homeScore > opts.awayScore ? 1 : 0,
  };
}

/**
 * ATS at American home line (favorite negative).
 * Cover: homeScore + line > awayScore; push when equal → excluded.
 */
export function settleAtsHome(opts: {
  homeScore: number;
  awayScore: number;
  homeSpreadLine: number;
  decided?: boolean;
}): AtsSettlement {
  if (opts.decided === false) {
    return { ok: false, reason: "invalid_final" };
  }
  if (
    !Number.isFinite(opts.homeScore) ||
    !Number.isFinite(opts.awayScore) ||
    !Number.isFinite(opts.homeSpreadLine)
  ) {
    return { ok: false, reason: "invalid_final" };
  }
  const adj = opts.homeScore + opts.homeSpreadLine - opts.awayScore;
  if (adj === 0) return { ok: false, reason: "push" };
  return { ok: true, yHomeCover: adj > 0 ? 1 : 0 };
}

export function settleTotal(opts: {
  homeScore: number;
  awayScore: number;
  totalLine: number;
  decided?: boolean;
}): TotalSettlement {
  if (opts.decided === false) {
    return { ok: false, reason: "invalid_final" };
  }
  if (
    !Number.isFinite(opts.homeScore) ||
    !Number.isFinite(opts.awayScore) ||
    !Number.isFinite(opts.totalLine)
  ) {
    return { ok: false, reason: "invalid_final" };
  }
  const sum = opts.homeScore + opts.awayScore;
  if (sum === opts.totalLine) return { ok: false, reason: "push" };
  return { ok: true, yOver: sum > opts.totalLine ? 1 : 0 };
}

/** Standard normal CDF (Abramowitz–Stegun). */
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

function clamp01(x: number): number {
  return Math.max(0.02, Math.min(0.98, x));
}

/**
 * Derive two-way ML P(home wins) from margin ~ Normal(μ, σ).
 * P(margin > 0); P(tie)=0 under continuous model (OT-inclusive two-way).
 */
export function pHomeMlFromMargin(marginMean: number, marginSd: number): number {
  const sd = Math.max(1e-6, marginSd);
  return clamp01(1 - normalCdf(-marginMean / sd));
}

/** P(home covers) at American home line. */
export function pHomeCoverFromMargin(
  marginMean: number,
  marginSd: number,
  homeSpreadLine: number,
): number {
  const sd = Math.max(1e-6, marginSd);
  // Cover when margin + line > 0 ⇒ margin > -line
  const z = (-homeSpreadLine - marginMean) / sd;
  return clamp01(1 - normalCdf(z));
}

/** P(over) from total ~ Normal(μ, σ). */
export function pOverFromTotal(
  totalMean: number,
  totalSd: number,
  totalLine: number,
): number {
  const sd = Math.max(1e-6, totalSd);
  return clamp01(1 - normalCdf((totalLine - totalMean) / sd));
}
