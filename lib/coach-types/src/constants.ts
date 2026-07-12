/** Shared Coach v2 policy constants — single source of truth for all modules. */

/** Pregame horizon: only recommend games starting within this window. */
export const COACH_HORIZON_MS = 48 * 60 * 60 * 1000;

/** Deep Monte Carlo iterations required before a leg may pass the simulation gate. */
export const COACH_DEEP_SIM_ITERATIONS = 10_000;

/** Quick discovery tier — not sufficient for gate qualification on its own. */
export const COACH_QUICK_SIM_ITERATIONS = 1_000;

/** Minimum confidence (0–100) for gate G4. Sport adapters may raise, never lower. */
export const COACH_MIN_CONFIDENCE_PCT = 52;

/**
 * Game line must beat the best remaining prop edge by at least this many
 * percentage points to take a ticket slot (prop-first policy).
 */
export const COACH_GAME_LINE_EDGE_OVERRIDE_PCT = 3;

/** Leg counts precomputed in background snapshots. */
export const COACH_PARLAY_SIZES = [3, 5, 6, 9, 10, 15] as const;
export type CoachParlayLegCount = (typeof COACH_PARLAY_SIZES)[number];

export const COACH_MAX_PARLAY_LEGS = 15;
export const COACH_MIN_PARLAY_LEGS = 3;

/** Snapshot TTL — background refresh cadence aligns with cron (2 min). */
export const COACH_SNAPSHOT_MAX_AGE_MS = 15 * 60_000;

/** Serve slightly stale snapshots while refresh runs (display-only client). */
export const COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS = 30 * 60_000;

/** Minimum settled picks per learning bucket before rank weights adjust. */
export const COACH_LEARNING_MIN_SAMPLE_SIZE = 20;

/** API version prefix for v2 routes. */
export const COACH_V2_API_VERSION = "v2" as const;

/** Postgres row id for global precomputed slate. */
export const COACH_SNAPSHOT_ROW_ID = "global" as const;
