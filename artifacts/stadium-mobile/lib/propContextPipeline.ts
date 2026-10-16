/**
 * Coach prop-context pipeline helpers — pure, no I/O.
 *
 * Bridges already-fetched board context (opp defense packs, MLB/football game
 * env) into projection inputs (weatherImpact, defenseIndexByFamily) without
 * per-player network calls. Missing data stays unknown — never invent.
 */

import type { FootballOppDefenseSlice } from "./footballRushDefense.ts";

export type PropContextFactorStatus =
  | "fetched_used_in_projection"
  | "fetched_used_in_grading"
  | "fetched_display_only"
  | "fetched_unused"
  | "missing_unknown";

export type PropContextFactorReport = {
  factor: "opponent_defense" | "weather" | "venue_field" | "injuries_lineups";
  status: PropContextFactorStatus;
  detail: string;
};

export type PropProjectionAdjustment = {
  name: string;
  source: string;
  /** Multiplier on projection mean (~1 = neutral). */
  factor: number;
  /** Optional hit-prob delta after sim (post-sim tilt). */
  hitDelta?: number;
};

export type PropProjectionTrace = {
  sport: string;
  market: string;
  side: string;
  line: number;
  baselineMean: number | null;
  adjustments: PropProjectionAdjustment[];
  /** Product of finite adjustment factors (1 when empty). */
  combinedFactor: number;
  finalMean: number | null;
  notes: string[];
};

/** League baselines for team defense → index (~1 = average). Honest constants. */
const DEFENSE_BASELINES: Record<
  string,
  Partial<Record<string, number>>
> = {
  nfl: {
    rush_yds: 112,
    rush_attempts: 26,
    pass_yds: 220,
    receptions: 20,
    points: 22,
  },
  ncaaf: {
    rush_yds: 150,
    rush_attempts: 36,
    pass_yds: 230,
    receptions: 18,
    points: 28,
  },
  nba: { points: 112, assists: 25, rebounds: 44, threes: 12 },
  wnba: { points: 82, assists: 18, rebounds: 34, threes: 8 },
  ncaab: { points: 72, assists: 13, rebounds: 35, threes: 7 },
  nhl: { goals: 3.0, shots: 30, points: 3.0 },
  soccer: { goals: 1.3 },
  mlb: { hits: 8.5, home_runs: 1.1, strikeouts: 8.5 },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function indexFromAllowed(
  allowed: number | null | undefined,
  baseline: number | undefined,
): number | null {
  if (allowed == null || !Number.isFinite(allowed) || allowed <= 0) return null;
  if (baseline == null || !(baseline > 0)) return null;
  // Higher yards/points allowed → softer D → index > 1 (boosts overs via matchup).
  return clamp(allowed / baseline, 0.88, 1.14);
}

/**
 * Build defenseIndexByFamily from an already-fetched opponent pack.
 * Returns null when no reliable sample/fields exist (caller omits → unknown).
 */
export function defenseIndexByFamilyFromPack(
  sport: string,
  pack: FootballOppDefenseSlice | null | undefined,
): Record<string, number> | null {
  if (!pack) return null;
  const sp = String(sport ?? "").toLowerCase();
  const baselines = DEFENSE_BASELINES[sp];
  if (!baselines) return null;
  const out: Record<string, number> = {};

  if (sp === "nfl" || sp === "ncaaf") {
    const rushSample = pack.rush?.sampleSize ?? 0;
    const passSample = pack.pass?.sampleSize ?? 0;
    if (rushSample >= 3 && pack.rush) {
      const idx = indexFromAllowed(
        pack.rush.rushingYardsAllowedPerGame,
        baselines.rush_yds,
      );
      if (idx != null) {
        out.rush_yds = idx;
        out.rush_attempts = idx;
        out.anytime_td = clamp(0.5 + 0.5 * idx, 0.9, 1.1);
      }
    }
    if (passSample >= 3 && pack.pass) {
      const idx = indexFromAllowed(
        pack.pass.passingYardsAllowedPerGame,
        baselines.pass_yds,
      );
      if (idx != null) {
        out.pass_yds = idx;
        out.pass_attempts = idx;
        out.pass_completions = idx;
        out.rec_yds = idx;
        out.receptions = idx;
      }
    }
  } else if (sp === "nba" || sp === "wnba" || sp === "ncaab") {
    const pts = indexFromAllowed(pack.pointsAgainst, baselines.points);
    if (pts != null) {
      out.points = pts;
      out.threes = pts;
      out.pra = pts;
    }
  } else if (sp === "nhl") {
    // Soft D from GAA: lower GAA → stingier → index < 1.
    const gaa = pack.goalsAgainstAvg;
    if (gaa != null && Number.isFinite(gaa) && gaa > 0) {
      const idx = clamp(gaa / (baselines.goals ?? 3), 0.88, 1.14);
      out.goals = idx;
      out.points = idx;
      out.shots = pack.shotsAgainst != null
        ? clamp(pack.shotsAgainst / (baselines.shots ?? 30), 0.88, 1.14)
        : idx;
    }
  } else if (sp === "soccer") {
    const gc = pack.goalsConceded;
    // Season totals — require gamesPlayed when present; else skip (unknown rate).
    const gp = pack.gamesPlayed;
    if (gc != null && gp != null && gp >= 5) {
      const perGame = gc / gp;
      const idx = indexFromAllowed(perGame, baselines.goals);
      if (idx != null) out.goals = idx;
    }
  } else if (sp === "mlb") {
    // ERA: lower → stingier pitching → suppress batter hit/HR overs (index < 1).
    if (pack.era != null && Number.isFinite(pack.era) && pack.era > 0) {
      const idx = clamp(pack.era / 4.1, 0.88, 1.14);
      out.hits = idx;
      out.home_runs = idx;
      out.total_bases = idx;
      out.rbi = idx;
      out.runs = idx;
    }
  }

  return Object.keys(out).length ? out : null;
}

type MlbEnvLike = {
  climateControlled?: boolean;
  park?: { dome?: boolean; hrIndex?: number | null; altitudeFt?: number | null } | null;
  weather?: {
    tempF?: number | null;
    windMph?: number | null;
    precipChancePct?: number | null;
    condition?: string | null;
  } | null;
  impactRating?: string | null;
};

/**
 * Map already-loaded game env → weatherImpact scalar for MLB prop MC.
 * Dome / climate-controlled → null (no invented outdoor effect).
 * Missing temp+precip → null (unknown). Never fabricates readings.
 */
export function weatherImpactFromGameEnv(
  sport: string,
  env: MlbEnvLike | null | undefined,
): number | null {
  const sp = String(sport ?? "").toLowerCase();
  // Prop MC applies weatherImpact only for MLB today — football stays holistic.
  if (sp !== "mlb") return null;
  if (!env) return null;
  if (env.climateControlled === true || env.park?.dome === true) return null;

  const rating = String(env.impactRating ?? "").toLowerCase();
  if (rating) {
    if (rating.includes("very favorable") || rating.includes("hitter")) return 0.45;
    if (rating.includes("favorable") || rating.includes("offense")) return 0.25;
    if (rating.includes("neutral")) return 0;
    if (rating.includes("very unfavorable") || rating.includes("pitcher")) return -0.45;
    if (rating.includes("unfavorable") || rating.includes("suppress")) return -0.25;
  }

  const w = env.weather;
  if (!w) return null;
  const tempF = w.tempF;
  const precip = w.precipChancePct;
  if (tempF == null && precip == null) return null;

  let score = 0;
  if (tempF != null) {
    if (tempF >= 85) score += 2;
    else if (tempF >= 75) score += 1;
    else if (tempF >= 60) score += 0;
    else if (tempF >= 50) score -= 1;
    else score -= 2;
  }
  if (precip != null) {
    if (precip >= 70) score -= 2;
    else if (precip >= 40) score -= 1;
  }
  // Park HR index soft nudge when present (real static index, not invented).
  const hr = env.park?.hrIndex;
  if (hr != null && Number.isFinite(hr)) {
    if (hr >= 110) score += 1;
    else if (hr <= 94) score -= 1;
  }

  if (score >= 2) return 0.45;
  if (score === 1) return 0.25;
  if (score === 0) return 0;
  if (score === -1) return -0.25;
  return -0.45;
}

/**
 * Resolve per-game projection context from board maps (no network).
 */
export function resolvePropSimContextForGame(opts: {
  sport: string;
  gameLabel: string;
  mlbGameEnv?: Record<string, unknown> | null;
  /** Opponent pack keyed by sport#teamId — caller passes the OPPONENT pack. */
  opponentPack?: FootballOppDefenseSlice | null;
}): {
  weatherImpact: number | null;
  defenseIndexByFamily: Record<string, number> | null;
  weatherStatus: PropContextFactorStatus;
  defenseStatus: PropContextFactorStatus;
} {
  const envRaw = opts.mlbGameEnv?.[opts.gameLabel] as MlbEnvLike | undefined;
  const weatherImpact = weatherImpactFromGameEnv(opts.sport, envRaw);
  const defenseIndexByFamily = defenseIndexByFamilyFromPack(
    opts.sport,
    opts.opponentPack,
  );

  return {
    weatherImpact,
    defenseIndexByFamily,
    weatherStatus:
      weatherImpact != null
        ? "fetched_used_in_projection"
        : envRaw
          ? envRaw.climateControlled || envRaw.park?.dome
            ? "fetched_used_in_grading"
            : "missing_unknown"
          : "missing_unknown",
    defenseStatus: defenseIndexByFamily
      ? "fetched_used_in_projection"
      : opts.opponentPack
        ? "fetched_used_in_grading"
        : "missing_unknown",
  };
}

/**
 * When defenseIndex entered the Monte Carlo projection, skip post-sim hit tilt
 * so opponent D is not counted twice on hitProbability.
 */
export function shouldApplyPostSimOppDefenseTilt(opts: {
  projectionUsedDefenseIndex: boolean;
}): boolean {
  return !opts.projectionUsedDefenseIndex;
}

/**
 * Build a representative projection trace for audits / tests.
 * Does not invent baseline — caller supplies measured/null baseline.
 */
export function buildPropProjectionTrace(opts: {
  sport: string;
  market: string;
  side: string;
  line: number;
  baselineMean: number | null;
  adjustments: PropProjectionAdjustment[];
}): PropProjectionTrace {
  const notes: string[] = [];
  const finite = opts.adjustments.filter(
    (a) => Number.isFinite(a.factor) && a.factor > 0,
  );
  const combinedFactor = finite.reduce((acc, a) => acc * a.factor, 1);
  let finalMean: number | null = null;
  if (opts.baselineMean != null && Number.isFinite(opts.baselineMean)) {
    finalMean = Math.max(0, opts.baselineMean * combinedFactor);
  } else {
    notes.push("baseline_unknown — final mean stays null (never invented)");
  }
  for (const a of opts.adjustments) {
    if (a.factor === 1 && (a.hitDelta == null || a.hitDelta === 0)) {
      notes.push(`${a.name}: neutral/absent (${a.source})`);
    }
  }
  return {
    sport: opts.sport,
    market: opts.market,
    side: opts.side,
    line: opts.line,
    baselineMean: opts.baselineMean,
    adjustments: opts.adjustments,
    combinedFactor,
    finalMean,
    notes,
  };
}

/**
 * Audit table for a single prop after context resolve.
 * Injuries: missing feed → unknown (never "healthy").
 */
export function auditPropContextFactors(opts: {
  sport: string;
  weatherStatus: PropContextFactorStatus;
  defenseStatus: PropContextFactorStatus;
  venueShiftApplied: boolean;
  venueDataPresent: boolean;
  injuryVacancyApplied: boolean;
  injuryFeedPresent: boolean;
  playerInjuryStatus: "found" | "none" | "ambiguous" | "unknown";
}): PropContextFactorReport[] {
  const injuryStatus: PropContextFactorStatus =
    opts.playerInjuryStatus === "found" && opts.injuryVacancyApplied
      ? "fetched_used_in_projection"
      : opts.playerInjuryStatus === "found"
        ? "fetched_used_in_grading"
        : opts.injuryFeedPresent && opts.playerInjuryStatus === "none"
          ? "fetched_unused"
          : "missing_unknown";

  return [
    {
      factor: "opponent_defense",
      status: opts.defenseStatus,
      detail:
        opts.defenseStatus === "missing_unknown"
          ? "No reliable opponent pack/sample — matchup stays 1.0"
          : "Opponent pack available",
    },
    {
      factor: "weather",
      status: opts.weatherStatus,
      detail:
        opts.weatherStatus === "missing_unknown"
          ? "No outdoor readings (or non-MLB) — weatherImpact omitted"
          : "Weather/park env available",
    },
    {
      factor: "venue_field",
      status: opts.venueShiftApplied
        ? "fetched_used_in_projection"
        : opts.venueDataPresent
          ? "fetched_used_in_grading"
          : "missing_unknown",
      detail: opts.venueShiftApplied
        ? "Home/away series venue shift in preSim"
        : "No venue shift (insufficient series)",
    },
    {
      factor: "injuries_lineups",
      status: injuryStatus,
      detail:
        opts.playerInjuryStatus === "ambiguous"
          ? "Ambiguous name match — status unknown (do not invent availability)"
          : opts.playerInjuryStatus === "none"
            ? "Player not on injury report (absence ≠ confirmed available)"
            : opts.playerInjuryStatus === "found"
              ? "Injury entry found"
              : "Injury feed missing — unknown",
    },
  ];
}
