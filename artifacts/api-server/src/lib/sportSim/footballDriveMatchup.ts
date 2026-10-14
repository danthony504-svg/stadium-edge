/**
 * Football (NFL/NCAAF) matchup helpers for drive sims.
 * - Soft scoring-rate map (monotonic above the old hard caps)
 * - Defense yards-allowed tilt into opposing offense means
 * - Sparse venue-split blend with L10
 *
 * Never invents defense or injury data — missing packs leave tilt at 1.0.
 */

export type FormSlice = {
  games?: number | null;
  ptsFor?: number | null;
  ptsAgainst?: number | null;
};

export type DefenseAllowedSlice = {
  rushingYardsAllowedPerGame?: number | null;
  passingYardsAllowedPerGame?: number | null;
  rushSampleSize?: number | null;
  passSampleSize?: number | null;
};

/** Former hard TD/FG caps — retained as soft knees, not flat ceilings. */
export const FOOTBALL_DRIVE_TD_RATE_KNEE = 0.42;
export const FOOTBALL_DRIVE_FG_RATE_KNEE = 0.28;
export const FOOTBALL_DRIVE_TD_PPD_DIVISOR = 28;
export const FOOTBALL_DRIVE_FG_PPD_DIVISOR = 40;
/**
 * Absolute ceilings keep td+fg ≤ ~0.98. Must sit high enough that typical
 * FBS game means (~20–35 as rate inputs) stay below the clip after soft slope.
 */
export const FOOTBALL_DRIVE_TD_RATE_MAX = 0.72;
export const FOOTBALL_DRIVE_FG_RATE_MAX = 0.30;
/** Slope retained above the knee so +3 ppg still moves rates. */
export const FOOTBALL_DRIVE_SOFT_SLOPE = 0.5;
/**
 * College game means are fed on the same scale as NFL but produce inflated
 * scores if used raw. Compress NCAAF rate inputs toward the sensitive band.
 */
export const FOOTBALL_COLLEGE_RATE_INPUT_SCALE = 0.48;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Soft rate map: linear below the former hard-cap knee, then compressed but
 * strictly increasing so offense/QB shocks remain sensitive until the absolute
 * ceiling (kept high enough for FBS means after college scaling).
 */
export function footballDriveScoringRates(ppd: number): {
  tdRate: number;
  fgRate: number;
} {
  const safe = Number.isFinite(ppd) ? Math.max(0, ppd) : 0;
  const tdLinear = safe / FOOTBALL_DRIVE_TD_PPD_DIVISOR;
  const fgLinear = safe / FOOTBALL_DRIVE_FG_PPD_DIVISOR;

  const soft = (linear: number, knee: number, max: number): number => {
    if (linear <= knee) return clamp(linear, 0, max);
    const excess = linear - knee;
    return clamp(knee + excess * FOOTBALL_DRIVE_SOFT_SLOPE, 0, max);
  };

  const tdRate = soft(tdLinear, FOOTBALL_DRIVE_TD_RATE_KNEE, FOOTBALL_DRIVE_TD_RATE_MAX);
  // Keep td+fg ≤ 0.98 so driveOutcome probabilities stay valid.
  const fgCap = Math.min(FOOTBALL_DRIVE_FG_RATE_MAX, Math.max(0, 0.98 - tdRate));
  const fgRate = Math.min(
    soft(fgLinear, FOOTBALL_DRIVE_FG_RATE_KNEE, FOOTBALL_DRIVE_FG_RATE_MAX),
    fgCap,
  );

  return { tdRate, fgRate };
}

/** Scale game-mean rate input for college so FBS sits in the sensitive band. */
export function footballDriveRateInput(offenseMean: number, sport: string): number {
  const safe = Number.isFinite(offenseMean) ? Math.max(0, offenseMean) : 0;
  const s = String(sport ?? "").toLowerCase();
  if (s === "ncaaf" || s === "cfb" || s.includes("ncaaf")) {
    return safe * FOOTBALL_COLLEGE_RATE_INPUT_SCALE;
  }
  return safe;
}

/** True when ppd is past the former hard-cap knee (rates still move, slowly). */
export function footballDriveRatesPastKnee(ppd: number): boolean {
  return ppd / FOOTBALL_DRIVE_TD_PPD_DIVISOR >= FOOTBALL_DRIVE_TD_RATE_KNEE;
}

/**
 * Prefer venue split when sample ≥ 2; blend 30/70 with L10 when venue n=1;
 * otherwise use L10. Prevents a single away game from dominating means.
 */
export function blendVenueAndL10(
  venue: FormSlice | null | undefined,
  l10: FormSlice | null | undefined,
): { ptsFor: number | null; ptsAgainst: number | null; provenance: string } {
  const vg = Number(venue?.games ?? 0);
  const vFor = venue?.ptsFor;
  const vAgainst = venue?.ptsAgainst;
  const lFor = l10?.ptsFor;
  const lAgainst = l10?.ptsAgainst;

  if (vg >= 2 && vFor != null && Number.isFinite(vFor)) {
    return {
      ptsFor: vFor,
      ptsAgainst: vAgainst != null && Number.isFinite(vAgainst) ? vAgainst : null,
      provenance: "venue_split",
    };
  }

  if (
    vg === 1 &&
    vFor != null &&
    Number.isFinite(vFor) &&
    lFor != null &&
    Number.isFinite(lFor)
  ) {
    const blend = (a: number, b: number) => a * 0.3 + b * 0.7;
    const against =
      vAgainst != null &&
      Number.isFinite(vAgainst) &&
      lAgainst != null &&
      Number.isFinite(lAgainst)
        ? blend(vAgainst, lAgainst)
        : (lAgainst ?? vAgainst ?? null);
    return {
      ptsFor: blend(vFor, lFor),
      ptsAgainst: against,
      provenance: "venue_l10_blend",
    };
  }

  if (lFor != null && Number.isFinite(lFor)) {
    return {
      ptsFor: lFor,
      ptsAgainst: lAgainst != null && Number.isFinite(lAgainst) ? lAgainst : null,
      provenance: "last10",
    };
  }

  return {
    ptsFor: vFor != null && Number.isFinite(vFor) ? vFor : null,
    ptsAgainst: vAgainst != null && Number.isFinite(vAgainst) ? vAgainst : null,
    provenance: vg > 0 ? "venue_thin" : "empty",
  };
}

/** League median total yards allowed / game — used only as a tilt anchor. */
export function footballDefenseLeagueMedianYards(sport: string): number {
  const s = String(sport ?? "").toLowerCase();
  if (s === "ncaaf" || s === "cfb") return 380;
  return 340; // NFL
}

/**
 * Combined rush+pass yards allowed when both samples are usable (≥2).
 * Returns null when data is too thin — callers must leave tilt at 1.0.
 */
export function combinedDefenseYardsAllowed(
  pack: DefenseAllowedSlice | null | undefined,
): { yards: number; sampleSize: number } | null {
  if (!pack) return null;
  const rushN = Number(pack.rushSampleSize ?? 0);
  const passN = Number(pack.passSampleSize ?? 0);
  const rush = pack.rushingYardsAllowedPerGame;
  const pass = pack.passingYardsAllowedPerGame;
  if (rushN < 2 || passN < 2) return null;
  if (rush == null || pass == null || !Number.isFinite(rush) || !Number.isFinite(pass)) {
    return null;
  }
  return { yards: rush + pass, sampleSize: Math.min(rushN, passN) };
}

/**
 * Soft defense → multiplier > 1 on opposing offense; stiff D → < 1.
 * Clamped to ±8%. Missing/thin pack → 1.0 (fail closed, no invent).
 */
export function defenseOffenseMultiplier(
  pack: DefenseAllowedSlice | null | undefined,
  sport: string,
): number {
  const combined = combinedDefenseYardsAllowed(pack);
  if (!combined) return 1;
  const median = footballDefenseLeagueMedianYards(sport);
  if (!(median > 0)) return 1;
  return clamp(combined.yards / median, 0.92, 1.08);
}

export function applyDefenseTiltToOffenseMean(
  offenseMean: number,
  opponentDefense: DefenseAllowedSlice | null | undefined,
  sport: string,
): number {
  return offenseMean * defenseOffenseMultiplier(opponentDefense, sport);
}
