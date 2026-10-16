/**
 * Football (NFL/NCAAF) matchup helpers for drive sims.
 * - Points per game → shared drive count → points per drive
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

/**
 * Live/verified football drive stamp (NFL + product NCAAF path).
 * Bump only when the shared points-per-drive conversion changes.
 * Do NOT bump this for NCAAF-only research calibration — use
 * `FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION` + `ncaafResearchCalibration` instead.
 */
export const FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1";

/**
 * Research-only stamp for NCAAF Phase E residual/shrink experiments.
 * Never accepted as the live client stamp. Applied only when
 * `SportSimContext.ncaafResearchCalibration === true` (or env
 * `NCAAF_RESEARCH_CALIBRATION=1` in offline scripts).
 */
export const FOOTBALL_NCAAF_RESEARCH_ENGINE_VERSION = "ppg-per-drive-v1.1-research";

/**
 * Extra NCAAF margin noise (points) — RESEARCH ONLY.
 * Locked 2026-10-16 from pre-cutoff diag (kickoff < 2024-10-15):
 * residual SD ≈ 19.46, mean sim SD ≈ 12.94 ⇒ complementary ≈ 14.5.
 * That 2024 window is now USED; do not re-tune on it.
 */
export const FOOTBALL_NCAAF_MARGIN_RESIDUAL_SD = 14.5;

/**
 * Home-margin shrink (points) — RESEARCH ONLY.
 * Locked at 2.0 from the same pre-cutoff diag (mean proj−actual ≈ +2.17).
 */
export const FOOTBALL_NCAAF_HOME_MARGIN_SHRINK = 2.0;

/** True when offline Phase E scripts opt into NCAAF research calibration. */
export function ncaafResearchCalibrationEnabled(
  flag?: boolean | null,
): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  const env = String(process.env.NCAAF_RESEARCH_CALIBRATION ?? "")
    .trim()
    .toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

/**
 * Former hard TD/FG caps from the points-per-game-as-points-per-drive map.
 * Kept only so older imports compile. The live map no longer uses them.
 */
export const FOOTBALL_DRIVE_TD_RATE_KNEE = 0.42;
export const FOOTBALL_DRIVE_FG_RATE_KNEE = 0.28;
export const FOOTBALL_DRIVE_TD_PPD_DIVISOR = 28;
export const FOOTBALL_DRIVE_FG_PPD_DIVISOR = 40;
export const FOOTBALL_DRIVE_TD_RATE_MAX = 0.72;
export const FOOTBALL_DRIVE_FG_RATE_MAX = 0.30;
export const FOOTBALL_DRIVE_SOFT_SLOPE = 0.5;

/**
 * Retired. Multiplying college points-per-game by 0.48 compensated for feeding
 * that game mean into a per-drive rate map. The live path divides by drive
 * count instead. Do not apply this scale.
 */
export const FOOTBALL_COLLEGE_RATE_INPUT_SCALE = 0.48;

/** One extra-point attempt per touchdown. Expected points, not a price. */
export const FOOTBALL_NFL_EXTRA_POINT_EXPECTED = 0.94;
export const FOOTBALL_NCAAF_EXTRA_POINT_EXPECTED = 0.94;

/**
 * Share of a drive's expected points that come from touchdowns (6 plus the
 * extra point). The rest are field goals. A structural split, not a market fit.
 */
export const FOOTBALL_TD_POINT_SHARE = 0.75;

/** tdRate + fgRate stay mutually exclusive and leave room for a non-scoring drive. */
export const FOOTBALL_DRIVE_SCORE_RATE_CAP = 0.98;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function isCollegeFootballSport(sport: string): boolean {
  const s = String(sport ?? "").toLowerCase();
  return s === "ncaaf" || s === "cfb" || s.includes("ncaaf");
}

/** Points awarded once per scoring event. A touchdown includes one extra point. */
export function footballDrivePoints(sport: string): { tdPoints: number; fgPoints: number } {
  const xp = isCollegeFootballSport(sport)
    ? FOOTBALL_NCAAF_EXTRA_POINT_EXPECTED
    : FOOTBALL_NFL_EXTRA_POINT_EXPECTED;
  return { tdPoints: 6 + xp, fgPoints: 3 };
}

/**
 * Shared drive count for both teams. Pace rises slowly with combined
 * points-per-game. NFL and NCAAF keep distinct scales.
 */
export function footballExpectedDrives(
  homePointsPerGame: number,
  awayPointsPerGame: number,
  sport: string,
): number {
  const college = isCollegeFootballSport(sport);
  const driveScale = college ? 70 : 55;
  const driveBase = 10;
  const sum =
    (Number.isFinite(homePointsPerGame) ? Math.max(0, homePointsPerGame) : 0) +
    (Number.isFinite(awayPointsPerGame) ? Math.max(0, awayPointsPerGame) : 0);
  return Math.max(6, Math.round(driveBase + sum / driveScale));
}

/** Drives on which the late-clock touchdown roll can fire (`d > drives * 0.7`). */
export function footballLateClockDriveCount(drives: number): number {
  const n = Math.max(0, Math.round(drives));
  let late = 0;
  for (let d = 0; d < n; d++) {
    if (d > n * 0.7) late += 1;
  }
  return late;
}

/**
 * Expected points from the late-clock touchdown, funded out of the
 * points-per-game budget so those scores are not added a second time.
 * Trailing probability is the opponent's share of the two game means.
 */
export function footballLateClockPointsBudget(opts: {
  drives: number;
  ownPointsPerGame: number;
  opponentPointsPerGame: number;
  lateClockTd: number;
  tdPoints: number;
}): number {
  const late = footballLateClockDriveCount(opts.drives);
  const own = Number.isFinite(opts.ownPointsPerGame) ? Math.max(0, opts.ownPointsPerGame) : 0;
  const opp = Number.isFinite(opts.opponentPointsPerGame)
    ? Math.max(0, opts.opponentPointsPerGame)
    : 0;
  const total = Math.max(0.01, own + opp);
  const pTrail = clamp(opp / total, 0.05, 0.85);
  const p = Number.isFinite(opts.lateClockTd) ? Math.max(0, opts.lateClockTd) : 0;
  const td = Number.isFinite(opts.tdPoints) ? Math.max(0, opts.tdPoints) : 0;
  return late * pTrail * p * td;
}

/**
 * Points per drive from a points-per-game mean and the drive count that will
 * actually be simulated. Same units for NFL and NCAAF.
 */
export function footballDriveRateInput(
  pointsPerGame: number,
  drives: number,
  _sport?: string,
): number {
  const ppg = Number.isFinite(pointsPerGame) ? Math.max(0, pointsPerGame) : 0;
  const n = Math.max(1, drives);
  return ppg / n;
}

/**
 * Mutually exclusive TD and FG probabilities for one drive.
 * `ppd` is points per drive. Expected points are
 * `tdRate * (6 + extra point) + fgRate * 3`, equal to `ppd` until the
 * joint ceiling. A drive cannot score both.
 */
export function footballDriveScoringRates(
  ppd: number,
  sport = "nfl",
): { tdRate: number; fgRate: number } {
  const safe = Number.isFinite(ppd) ? Math.max(0, ppd) : 0;
  const { tdPoints, fgPoints } = footballDrivePoints(sport);
  let tdRate = tdPoints > 0 ? (FOOTBALL_TD_POINT_SHARE * safe) / tdPoints : 0;
  let fgRate = fgPoints > 0 ? ((1 - FOOTBALL_TD_POINT_SHARE) * safe) / fgPoints : 0;
  const sum = tdRate + fgRate;
  if (sum > FOOTBALL_DRIVE_SCORE_RATE_CAP && sum > 0) {
    const scale = FOOTBALL_DRIVE_SCORE_RATE_CAP / sum;
    tdRate *= scale;
    fgRate *= scale;
  }
  return { tdRate, fgRate };
}

/** Expected points from one drive before the late-clock add. */
export function footballExpectedPointsPerDrive(ppd: number, sport = "nfl"): number {
  const { tdRate, fgRate } = footballDriveScoringRates(ppd, sport);
  const { tdPoints, fgPoints } = footballDrivePoints(sport);
  return tdRate * tdPoints + fgRate * fgPoints;
}

/** True when the joint TD+FG ceiling is binding (absurd points-per-drive). */
export function footballDriveRatesPastKnee(ppd: number, sport = "nfl"): boolean {
  const safe = Number.isFinite(ppd) ? Math.max(0, ppd) : 0;
  const { tdPoints, fgPoints } = footballDrivePoints(sport);
  const td = tdPoints > 0 ? (FOOTBALL_TD_POINT_SHARE * safe) / tdPoints : 0;
  const fg = fgPoints > 0 ? ((1 - FOOTBALL_TD_POINT_SHARE) * safe) / fgPoints : 0;
  return td + fg >= FOOTBALL_DRIVE_SCORE_RATE_CAP - 1e-9;
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
