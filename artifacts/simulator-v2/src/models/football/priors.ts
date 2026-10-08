/**
 * League-level football priors for Phase B joint simulation.
 * Shares are empirical-ish anchors (not V1 frac overwrite); team history overrides when present.
 */

export type FootballSport = "nfl" | "ncaaf";

/** Mean share of full-game points by quarter (sums to 1). */
export const LEAGUE_QUARTER_SHARES: Record<FootballSport, readonly [number, number, number, number]> = {
  // Slightly higher Q2/Q4 scoring; distinct from V1's flat 0.26/0.24/0.26/0.24.
  nfl: [0.22, 0.27, 0.23, 0.28],
  ncaaf: [0.23, 0.26, 0.24, 0.27],
};

/** Typical FG points per team when no form data is available. */
export const LEAGUE_FG_MEAN: Record<FootballSport, number> = {
  nfl: 22.5,
  ncaaf: 27.0,
};

/** Relative std of quarter Poisson process (pace / volatility). */
export const QUARTER_PACE_SIGMA: Record<FootballSport, number> = {
  nfl: 0.12,
  ncaaf: 0.14,
};

export function isFootballSport(sport: string): sport is FootballSport {
  return sport === "nfl" || sport === "ncaaf";
}
