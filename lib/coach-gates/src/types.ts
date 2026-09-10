import type {
  CoachCandidateLeg,
  CoachSimResult,
  CoachSportAdapter,
  CoachSportContext,
} from "@workspace/coach-types";

/** Minimum recent games required before the trends gate may pass. */
export const COACH_MIN_TREND_SAMPLE = 3;

/** Momentum below this threshold fails the trends gate. */
export const COACH_TREND_FAIL_MOMENTUM = -0.15;

/** Injury favor below this threshold fails the injuries gate. */
export const COACH_INJURY_FAIL_FAVOR = -0.25;

export type CoachGateMatchupSlice = {
  mlLean?: { side: string; edge: number } | null;
  /** Team name for game-line picks; null for totals or unresolved sides. */
  pickTeam?: string | null;
};

export type CoachGateTrendSlice = {
  momentum?: number | null;
  sampleSize?: number;
};

export type CoachGateInjurySlice = {
  /** -1..1 read of injury picture toward the pick. */
  favor?: number | null;
};

export type CoachGateLineMovementSlice = {
  direction?: "toward" | "against" | "neutral" | null;
  magnitudePct?: number | null;
};

/**
 * Structured slices resolved per candidate before gate evaluation.
 * Built from CoachSportContext by coach-data (or api-server) — not raw records.
 */
export type CoachGateEvaluationContext = {
  matchup?: CoachGateMatchupSlice;
  trends?: CoachGateTrendSlice;
  injuries?: CoachGateInjurySlice;
  lineMovement?: CoachGateLineMovementSlice;
};

export type CoachGateEvaluateInput = {
  candidate: CoachCandidateLeg;
  sim: CoachSimResult | null;
  context: CoachGateEvaluationContext;
  adapter: CoachSportAdapter;
  /** Raw sport context for adapter sport-specific gate. */
  sportContext: CoachSportContext;
};
