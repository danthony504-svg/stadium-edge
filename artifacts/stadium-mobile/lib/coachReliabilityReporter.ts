/**
 * Observe-only Coach reliability reporter.
 * Fire-and-forget POST to /reliability/coach-events — never blocks scans,
 * never changes selection / grading / simulation / UI.
 */

import { shouldSendCrashReports } from "./crashReportingGate.ts";
import { mapScanFailureCode } from "./coachReliabilityClassify.ts";
import {
  affectedGameFromPicks,
  evaluateReturnedPicksGrounding,
  type CoachReliabilityGroundingPick,
} from "./coachReliabilityGrounding.ts";
import {
  logCoachRelDiagCall,
  logCoachRelDiagPostResult,
  newCoachRelCorrelationId,
} from "./coachReliabilityDiag.ts";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";
const REPORT_TIMEOUT_MS = 4_000;
const MAX_IN_FLIGHT = 2;
let inFlight = 0;
/** Full successes POST once per requestId (delivery-commit path). */
const fulfilledPostedRequestIds = new Set<string>();

/** Test-only — clear once-per-request fulfilled gate. */
export function resetCoachReliabilityFulfilledDedupeForTests(): void {
  fulfilledPostedRequestIds.clear();
}

export type CoachReliabilityReportInput = {
  requestId?: string | null;
  sportCategory?: string | null;
  requestedLegCount?: number | null;
  returnedLegCount?: number | null;
  durationMs?: number | null;
  realOddsAvailable?: boolean | null;
  scanFailureCode?: string | null;
  scanFailureDetail?: string | null;
  affectedGame?: string | null;
  timedOut?: boolean;
  scanMissing?: boolean;
  /**
   * True only after a complete, qualified ticket is latched for UI delivery.
   * Required to count `parlay_fulfilled` — assembly alone is not success.
   */
  deliveryCommitted?: boolean;
  /** User stop / abort — never counts as delivery success. */
  cancelled?: boolean;
  /** Phase timing (observe-only; no selection change). */
  loadMs?: number | null;
  scanMs?: number | null;
  finalizationMs?: number | null;
  totalMs?: number | null;
  lastCompletedPhase?: string | null;
  pendingOperation?: string | null;
  timeoutReason?: string | null;
  rootCauseGrade?: "verified" | "inferred" | "generic" | null;
  /** Returned ticket picks — used for grounding vs legitimate-underfill. */
  picks?: readonly CoachReliabilityGroundingPick[] | null;
  /** Explicit event type when not derived from scanFailureCode. */
  eventType?: string | null;
  failureReason?: string | null;
  rootCause?: string | null;
  /** Test fixtures — server rejects Telegram for these. */
  testFixture?: boolean;
  /**
   * Temporary client↔server correlation id for /reliability/coach-events diagnostics.
   * Generated when omitted. Does not change classification.
   */
  correlationId?: string | null;
};

function timingFields(input: CoachReliabilityReportInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.loadMs != null) out.loadMs = input.loadMs;
  if (input.scanMs != null) out.scanMs = input.scanMs;
  if (input.finalizationMs != null) out.finalizationMs = input.finalizationMs;
  if (input.totalMs != null) out.totalMs = input.totalMs;
  else if (input.durationMs != null) out.totalMs = input.durationMs;
  if (input.lastCompletedPhase) out.lastCompletedPhase = input.lastCompletedPhase;
  if (input.pendingOperation) out.pendingOperation = input.pendingOperation;
  if (input.timeoutReason) out.timeoutReason = input.timeoutReason;
  if (input.rootCauseGrade) out.rootCauseGrade = input.rootCauseGrade;
  return out;
}

function eventTypeCandidateFromBody(
  body: Record<string, unknown> | null,
): string | null {
  if (!body) return null;
  if (typeof body.eventType === "string" && body.eventType) return body.eventType;
  if (typeof body.scanFailureCode === "string" && body.scanFailureCode) {
    return `scan:${body.scanFailureCode}`;
  }
  return null;
}

/**
 * Classify + report a completed board scan / parlay build outcome.
 * Never throws. No-ops in Node tests / CI (same gate as crash reporter).
 */
export function reportCoachScanReliability(
  input: CoachReliabilityReportInput,
): void {
  try {
    const correlationId =
      (input.correlationId && String(input.correlationId).trim()) ||
      newCoachRelCorrelationId();
    const requestId =
      input.requestId != null ? String(input.requestId) : null;
    const returnedPickCount =
      typeof input.returnedLegCount === "number"
        ? input.returnedLegCount
        : (input.picks?.length ?? 0);

    const body = buildCoachReliabilityBody({
      ...input,
      correlationId,
    });

    // Temporary diagnostics — log even when body is null (full ticket / no event).
    logCoachRelDiagCall({
      correlationId,
      requestId,
      eventTypeCandidate: eventTypeCandidateFromBody(body),
      returnedPickCount,
      picks: input.picks,
    });

    if (!shouldSendCrashReports()) {
      logCoachRelDiagPostResult({
        correlationId,
        requestId,
        httpStatus: null,
        success: false,
        error: "reporting_gated",
      });
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      logCoachRelDiagPostResult({
        correlationId,
        requestId,
        httpStatus: null,
        success: false,
        error: "in_flight_cap",
      });
      return;
    }
    if (!body) {
      logCoachRelDiagPostResult({
        correlationId,
        requestId,
        httpStatus: null,
        success: false,
        error: "no_body",
      });
      return;
    }

    // Full success: one POST per requestId (budget path + finishSession must not double-count).
    if (body.eventType === "parlay_fulfilled" && requestId) {
      if (fulfilledPostedRequestIds.has(requestId)) {
        logCoachRelDiagPostResult({
          correlationId,
          requestId,
          httpStatus: null,
          success: false,
          error: "fulfilled_deduped",
        });
        return;
      }
      fulfilledPostedRequestIds.add(requestId);
    }

    inFlight += 1;
    void (async () => {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), REPORT_TIMEOUT_MS);
        try {
          const res = await fetch(`${API_BASE}/reliability/coach-events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ac.signal,
          });
          logCoachRelDiagPostResult({
            correlationId,
            requestId,
            httpStatus: res.status,
            success: res.ok,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        logCoachRelDiagPostResult({
          correlationId,
          requestId,
          httpStatus: null,
          success: false,
          error: err instanceof Error ? err.name : "fetch_failed",
        });
      } finally {
        inFlight = Math.max(0, inFlight - 1);
      }
    })();
  } catch {
    // Fail soft.
  }
}

/** Pure: build POST body or null when there is nothing alertable/digest-worthy. */
export function buildCoachReliabilityBody(
  input: CoachReliabilityReportInput,
): Record<string, unknown> | null {
  const requested =
    typeof input.requestedLegCount === "number" ? input.requestedLegCount : null;
  const returned =
    typeof input.returnedLegCount === "number" ? input.returnedLegCount : null;

  const grounding = evaluateReturnedPicksGrounding(input.picks);
  const affectedGame =
    (input.affectedGame && String(input.affectedGame).trim()) ||
    grounding.affectedGame ||
    affectedGameFromPicks(input.picks) ||
    null;

  const correlationId =
    input.correlationId && String(input.correlationId).trim()
      ? String(input.correlationId).trim().slice(0, 80)
      : null;
  const corr = correlationId ? { correlationId } : {};
  const timing = timingFields(input);

  const fullQualifiedTicket =
    requested != null &&
    returned != null &&
    returned > 0 &&
    returned >= requested;

  // User cancel / stop — never parlay_fulfilled, even with a full buffer.
  if (input.cancelled) {
    return {
      eventType: "coach_exception",
      failureReason: "exception",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "user_cancelled",
      rootCauseGrade: "verified",
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  // Timeout / missing scan — only when a full ticket was not already assembled.
  // Freeze detail must include evidence-supported phase (not opaque ~180s label).
  if ((input.scanMissing || input.timedOut) && !fullQualifiedTicket) {
    const detail = input.scanMissing
      ? "board scan missing"
      : input.timeoutReason
        ? `deadline:${input.timeoutReason}`
        : "delivery budget / freeze";
    return {
      scanFailureCode: input.scanMissing ? "SCAN_THREW" : "ABSOLUTE_BUDGET",
      scanFailureDetail: detail,
      eventType: input.timedOut ? "coach_scan_freeze" : undefined,
      failureReason: input.timedOut ? "scan_freeze" : undefined,
      sportCategory: input.sportCategory ?? "unspecified",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause:
        input.rootCause ??
        (input.timeoutReason ? String(input.timeoutReason) : null),
      rootCauseGrade: input.rootCauseGrade ?? (input.timeoutReason ? "verified" : "generic"),
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  // Player/team/game mismatch on any returned selection → grounding (Telegram).
  // Must win over fulfillment / thin-slate / scan underfill classification.
  if (grounding.hasMismatch) {
    return {
      eventType: "coach_grounding_failure",
      failureReason: "grounding_failure",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      qualificationFiltersEliminated: false,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "player_game_grounding_mismatch",
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  // Complete qualified ticket committed for delivery — sole success path.
  if (fullQualifiedTicket && input.deliveryCommitted) {
    return {
      eventType: "parlay_fulfilled",
      failureReason: "none",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? null,
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  // Assembled full ticket without UI commit — not success (and not freeze).
  if (fullQualifiedTicket && !input.deliveryCommitted) {
    return null;
  }

  if (input.scanFailureCode) {
    const mapped = mapScanFailureCode(String(input.scanFailureCode));
    if (!mapped) return null;
    return {
      scanFailureCode: input.scanFailureCode,
      scanFailureDetail: input.scanFailureDetail ?? mapped.failureReason,
      sportCategory: input.sportCategory ?? "unspecified",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? input.scanFailureDetail ?? null,
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  // Shortfall with every returned selection grounded → legitimate underfill (digest).
  if (
    requested != null &&
    returned != null &&
    returned > 0 &&
    returned < requested
  ) {
    return {
      eventType: "parlay_underfilled",
      failureReason: "legitimate_underfill",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      qualificationFiltersEliminated: true,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "thin_slate_or_quality_bar",
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  if (requested != null && returned === 0) {
    const blocked =
      input.failureReason === "blocked_unvalidated_market" ||
      input.scanFailureCode === "P0_UNVALIDATED_MARKETS";
    return {
      eventType: "parlay_zero_results",
      failureReason: blocked
        ? "blocked_unvalidated_market"
        : input.realOddsAvailable === false
          ? "odds_mismatch"
          : "zero_results",
      ...(blocked ? { scanFailureCode: "P0_UNVALIDATED_MARKETS" } : {}),
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: 0,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: blocked
        ? (input.rootCause ?? "unvalidated_ncaaf_game_line_simulation")
        : (input.rootCause ?? "zero_results"),
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  if (input.eventType) {
    return {
      eventType: input.eventType,
      failureReason: input.failureReason ?? "unknown",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? null,
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  return null;
}
