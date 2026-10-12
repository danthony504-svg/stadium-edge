/**
 * Single Coach quality authority — every seating path must pass this before
 * staging/top-up/final ticket. Sport-specific sim/context stays elsewhere;
 * quality thresholds live here only.
 *
 * Hard rules:
 * - Raw confidence only (never lift to pass).
 * - Positive EV alone never qualifies.
 * - Style may add stricter rules; never weaker than the shared floor for
 *   normal / props_only asks.
 */

import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  meetsCoachSimQualityFloor,
  simEvPct,
} from "../gameSimQualityGates.ts";
import { impliedProb } from "../format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "../simMarketSupport.ts";

/** Bump when qualification/render pipeline semantics change (device diagnostics). */
export const COACH_PIPELINE_VERSION = "unified-quality-v1";

export type CoachRequestStyle = "normal" | "props_only" | "longshot";

export type CoachQualificationStatus = "qualified" | "rejected";

export type CoachQualificationReason =
  | "ok"
  | "missing_score"
  | "sim_unsupported"
  | "sim_invalid"
  | "grade_floor"
  | "confidence_floor"
  | "non_positive_edge"
  | "non_positive_ev"
  | "sim_not_above_implied"
  | "style_blocked";

export type CoachQualifyContext = {
  /** Request style — normal N-leg and props_only share the same minimum floor. */
  requestStyle?: CoachRequestStyle;
  /** When true, treat as prop market (line/odds EV checks). */
  isProp?: boolean;
};

export type CoachQualifyInput = {
  market?: string | null;
  sport?: string | null;
  isProp?: boolean | null;
  odds?: number | null;
  propsOnlyTicket?: boolean | null;
  qualificationStatus?: CoachQualificationStatus | null;
  finalAiScore?: {
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    simHit?: number | null;
  } | null;
  /** Optional overrides when score is on a BoardScoredLeg, not the pick. */
  grade?: string | null;
  confidencePct?: number | null;
  edgePct?: number | null;
  simHit?: number | null;
};

export type CoachQualifyResult = {
  status: CoachQualificationStatus;
  reason: CoachQualificationReason;
  /** Pipeline marker for logs / diagnostics. */
  pipelineVersion: string;
};

function rawGrade(input: CoachQualifyInput): string | null {
  return input.grade ?? input.finalAiScore?.grade ?? null;
}

/** Genuine confidence only — never a simHit-derived lift. */
function rawConfidence(input: CoachQualifyInput): number {
  const v = input.confidencePct ?? input.finalAiScore?.confidencePct;
  return v != null && Number.isFinite(v) ? v : 0;
}

function rawEdge(input: CoachQualifyInput): number {
  const v = input.edgePct ?? input.finalAiScore?.edgePct;
  return v != null && Number.isFinite(v) ? v : 0;
}

function rawSimHit(input: CoachQualifyInput): number | null {
  const v = input.simHit ?? input.finalAiScore?.simHit;
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * Shared minimum quality authority for Coach ticket seating.
 * Rejected candidates are terminally ineligible for staging/top-up/fallback.
 */
export function qualifyCoachCandidate(
  input: CoachQualifyInput,
  ctx: CoachQualifyContext = {},
): CoachQualifyResult {
  const pipelineVersion = COACH_PIPELINE_VERSION;
  const style: CoachRequestStyle = ctx.requestStyle ?? "normal";

  if (input.qualificationStatus === "rejected") {
    return { status: "rejected", reason: "style_blocked", pipelineVersion };
  }

  const grade = rawGrade(input);
  const confidencePct = rawConfidence(input);
  const edgePct = rawEdge(input);
  const simHit = rawSimHit(input);
  const isProp = !!(ctx.isProp ?? input.isProp);
  const market = String(input.market ?? "");

  if (grade == null && input.finalAiScore == null && input.confidencePct == null) {
    return { status: "rejected", reason: "missing_score", pipelineVersion };
  }

  const sport = input.sport ?? null;
  if (market && !marketSupportsSimulation(market, { isProp, market, sport })) {
    return { status: "rejected", reason: "sim_unsupported", pipelineVersion };
  }

  if (!pickHasSimGrade({ isProp, market, sport }, simHit)) {
    return { status: "rejected", reason: "sim_invalid", pipelineVersion };
  }

  // Shared floor — single source (gameSimQualityGates). No confidence lift.
  if (!meetsCoachSimQualityFloor({ grade, confidencePct })) {
    if ((confidencePct ?? 0) < COACH_SIM_MIN_CONFIDENCE) {
      return { status: "rejected", reason: "confidence_floor", pipelineVersion };
    }
    return { status: "rejected", reason: "grade_floor", pipelineVersion };
  }

  if (edgePct <= 0) {
    return { status: "rejected", reason: "non_positive_edge", pipelineVersion };
  }

  const odds = input.odds;
  if (simHit != null && odds != null && Number.isFinite(odds) && odds !== 0) {
    if (simHit <= impliedProb(odds)) {
      return { status: "rejected", reason: "sim_not_above_implied", pipelineVersion };
    }
    const ev = simEvPct(simHit, odds);
    if (ev != null && ev <= 0) {
      return { status: "rejected", reason: "non_positive_ev", pipelineVersion };
    }
  }

  // Longshot may be extended later with an explicit policy; until then it must
  // not silently weaken the shared floor for normal / props_only asks.
  if (style === "longshot") {
    // Same minimum as normal for now (explicit policy placeholder).
  }

  return { status: "qualified", reason: "ok", pipelineVersion };
}

/** True when shared authority accepts the candidate. */
export function coachCandidateIsQualified(
  input: CoachQualifyInput,
  ctx: CoachQualifyContext = {},
): boolean {
  return qualifyCoachCandidate(input, ctx).status === "qualified";
}

/** Tag a pick with terminal qualification status (staging consumes only qualified). */
export function withCoachQualification<T extends CoachQualifyInput>(
  pick: T,
  ctx: CoachQualifyContext = {},
): T & { qualificationStatus: CoachQualificationStatus; qualificationReason: CoachQualificationReason } {
  const result = qualifyCoachCandidate(pick, ctx);
  return {
    ...pick,
    qualificationStatus: result.status,
    qualificationReason: result.reason,
  };
}

export { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE, meetsCoachSimQualityFloor };
