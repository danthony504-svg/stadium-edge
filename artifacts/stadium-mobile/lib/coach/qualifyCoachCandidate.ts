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
 * - Qualify once → attach immutable status → downstream reads it.
 * - `rejected` is terminal; no seating path may promote it to `qualified`.
 */

import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  meetsCoachSimQualityFloor,
  simEvPct,
} from "../gameSimQualityGates.ts";
import { impliedProb } from "../format.ts";
import { marketSupportsSimulation, pickHasSimGrade } from "../simMarketSupport.ts";
import {
  propProvenanceAllowsSeating,
  type ExactMarketCandidate,
  type PropProbabilityProvenance,
} from "../coachPropProbabilityProvenance.ts";

/** Bump when qualification/render pipeline semantics change (device diagnostics). */
export const COACH_PIPELINE_VERSION = "unified-quality-v1";

export type CoachRequestStyle = "normal" | "props_only" | "longshot";

export type CoachQualificationStatus = "qualified" | "rejected";

export type CoachQualificationReason =
  | "ok"
  | "missing_score"
  | "sim_unsupported"
  | "sim_invalid"
  | "insufficient_sim_provenance"
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
  /** Attached by withCoachQualification — downstream reads; do not forge. */
  coachRequestStyle?: CoachRequestStyle | null;
  qualificationStatus?: CoachQualificationStatus | null;
  qualificationReason?: CoachQualificationReason | null;
  finalAiScore?: {
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    simHit?: number | null;
    propProbabilityProvenance?: PropProbabilityProvenance | null;
  } | null;
  /** Optional overrides when score is on a BoardScoredLeg, not the pick. */
  grade?: string | null;
  confidencePct?: number | null;
  edgePct?: number | null;
  simHit?: number | null;
  /** Option C — required for player props; missing ⇒ insufficient. */
  propProbabilityProvenance?: PropProbabilityProvenance | null;
  /** Exact-market identity — used to bind provenance to this candidate. */
  athleteId?: string | null;
  eventId?: string | null;
  propMarketKey?: string | null;
  propSide?: string | null;
  propLine?: number | null;
};

export type CoachQualifyResult = {
  status: CoachQualificationStatus;
  reason: CoachQualificationReason;
  /** Pipeline marker for logs / diagnostics. */
  pipelineVersion: string;
};

export type CoachQualifiedPick<T> = T & {
  qualificationStatus: CoachQualificationStatus;
  qualificationReason: CoachQualificationReason;
  coachRequestStyle: CoachRequestStyle;
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
 * Map ticket style / props-only flags to the shared request style.
 * Longshot is explicit only — never inferred from "need N legs".
 */
export function resolveCoachRequestStyle(opts: {
  propsOnly?: boolean | null;
  ticketStyle?: string | null;
  coachRequestStyle?: CoachRequestStyle | null;
}): CoachRequestStyle {
  if (opts.propsOnly) return "props_only";
  if (
    opts.coachRequestStyle === "longshot" ||
    opts.coachRequestStyle === "props_only" ||
    opts.coachRequestStyle === "normal"
  ) {
    return opts.coachRequestStyle;
  }
  if (opts.ticketStyle === "longshot") return "longshot";
  return "normal";
}

/**
 * Full quality evaluation. Ignores a forged `qualified` stamp; honors terminal
 * `rejected`. Used by withCoachQualification at the attach boundary.
 */
export function evaluateCoachQualification(
  input: CoachQualifyInput,
  ctx: CoachQualifyContext = {},
): CoachQualifyResult {
  const pipelineVersion = COACH_PIPELINE_VERSION;
  const style: CoachRequestStyle =
    ctx.requestStyle ??
    resolveCoachRequestStyle({
      propsOnly: input.propsOnlyTicket,
      coachRequestStyle: input.coachRequestStyle,
    });

  if (input.qualificationStatus === "rejected") {
    return {
      status: "rejected",
      reason: input.qualificationReason ?? "style_blocked",
      pipelineVersion,
    };
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

  // Option C — player props need trusted provenance bound to this candidate.
  if (isProp) {
    const provenance =
      input.propProbabilityProvenance ??
      input.finalAiScore?.propProbabilityProvenance ??
      null;
    const candidate: ExactMarketCandidate = {
      athleteId: input.athleteId,
      eventId: input.eventId,
      propMarketKey: input.propMarketKey ?? input.market,
      market: input.market,
      propSide: input.propSide,
      propLine: input.propLine,
    };
    if (!propProvenanceAllowsSeating(provenance, candidate)) {
      return {
        status: "rejected",
        reason: "insufficient_sim_provenance",
        pipelineVersion,
      };
    }
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

  // Longshot may add stricter policy later; must never weaken the shared floor.
  if (style === "longshot") {
    // Same absolute minimum as normal for now.
  }

  return { status: "qualified", reason: "ok", pipelineVersion };
}

/**
 * Shared minimum quality authority for Coach ticket seating.
 * Attached `qualified` trusts prior grade/conf/edge floors (no recompute) but
 * always re-validates prop provenance so stale/forged stamps cannot seat.
 */
export function qualifyCoachCandidate(
  input: CoachQualifyInput,
  ctx: CoachQualifyContext = {},
): CoachQualifyResult {
  const pipelineVersion = COACH_PIPELINE_VERSION;
  if (input.qualificationStatus === "rejected") {
    return {
      status: "rejected",
      reason: input.qualificationReason ?? "style_blocked",
      pipelineVersion,
    };
  }
  if (input.qualificationStatus === "qualified") {
    const isProp = !!(ctx.isProp ?? input.isProp);
    if (isProp) {
      const provenance =
        input.propProbabilityProvenance ??
        input.finalAiScore?.propProbabilityProvenance ??
        null;
      const candidate: ExactMarketCandidate = {
        athleteId: input.athleteId,
        eventId: input.eventId,
        propMarketKey: input.propMarketKey ?? input.market,
        market: input.market,
        propSide: input.propSide,
        propLine: input.propLine,
      };
      if (!propProvenanceAllowsSeating(provenance, candidate)) {
        return {
          status: "rejected",
          reason: "insufficient_sim_provenance",
          pipelineVersion,
        };
      }
    }
    return {
      status: "qualified",
      reason: input.qualificationReason ?? "ok",
      pipelineVersion,
    };
  }
  return evaluateCoachQualification(input, ctx);
}

/** True when shared authority accepts the candidate. */
export function coachCandidateIsQualified(
  input: CoachQualifyInput,
  ctx: CoachQualifyContext = {},
): boolean {
  return qualifyCoachCandidate(input, ctx).status === "qualified";
}

/**
 * Attach immutable qualification from a fresh evaluation.
 * Never preserves a forged `qualified` stamp — always re-evaluates metrics
 * (unless already terminal `rejected`).
 */
export function withCoachQualification<T extends CoachQualifyInput>(
  pick: T,
  ctx: CoachQualifyContext = {},
): CoachQualifiedPick<T> {
  const requestStyle = resolveCoachRequestStyle({
    propsOnly: ctx.requestStyle === "props_only" || !!pick.propsOnlyTicket,
    ticketStyle: ctx.requestStyle === "longshot" ? "longshot" : undefined,
    coachRequestStyle: ctx.requestStyle ?? pick.coachRequestStyle,
  });
  const effectiveCtx: CoachQualifyContext = {
    ...ctx,
    requestStyle,
    isProp: ctx.isProp ?? !!pick.isProp,
  };
  const result = evaluateCoachQualification(
    {
      ...pick,
      // Force fresh metric evaluation (ignore forged qualified).
      qualificationStatus:
        pick.qualificationStatus === "rejected" ? "rejected" : undefined,
      qualificationReason:
        pick.qualificationStatus === "rejected" ? pick.qualificationReason : undefined,
      coachRequestStyle: requestStyle,
    },
    effectiveCtx,
  );
  return {
    ...pick,
    coachRequestStyle: requestStyle,
    qualificationStatus: result.status,
    qualificationReason: result.reason,
  };
}

export { COACH_SIM_MIN_CONFIDENCE, COACH_SIM_MIN_GRADE, meetsCoachSimQualityFloor };
