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
import {
  coachPerfBodyFields,
  deriveCoachTerminalStatus,
  resolveCoachClientUpdateId,
  type CoachTerminalStatus,
} from "./coachPerfDiagnostics.ts";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";
const REPORT_TIMEOUT_MS = 4_000;
const MAX_IN_FLIGHT = 2;
let inFlight = 0;
/** Full successes POST once per requestId (delivery-commit path). */
const fulfilledPostedRequestIds = new Set<string>();
/** Any terminal coach-events POST once per requestId (exactly-one contract). */
const terminalPostedRequestIds = new Set<string>();

/** Test-only — clear once-per-request fulfilled / terminal gates. */
export function resetCoachReliabilityFulfilledDedupeForTests(): void {
  fulfilledPostedRequestIds.clear();
  terminalPostedRequestIds.clear();
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
  /** Expo Updates.updateId — resolved lazily when omitted. */
  updateId?: string | null;
  /** Wall clock for context enrichment Promise.all (alias of contextMs). */
  enrichmentMs?: number | null;
  propSimMs?: number | null;
  gameSimMs?: number | null;
  qualificationMs?: number | null;
  requestedSport?: string | null;
  effectiveSports?: readonly string[] | null;
  terminalStatus?: CoachTerminalStatus | string | null;
  candidatesPoolBefore?: number | null;
  candidatesPoolAfter?: number | null;
  candidatesSelected?: number | null;
  deepSimRequested?: number | null;
  deepSimCompleted?: number | null;
  qualifiedCount?: number | null;
};

function timingFields(input: CoachReliabilityReportInput): Record<string, unknown> {
  const updateId =
    (input.updateId && String(input.updateId).trim()) ||
    resolveCoachClientUpdateId();
  const out = coachPerfBodyFields({
    updateId,
    enrichmentMs: input.enrichmentMs,
    propSimMs: input.propSimMs,
    gameSimMs: input.gameSimMs,
    qualificationMs: input.qualificationMs,
    loadMs: input.loadMs,
    scanMs: input.scanMs,
    finalizationMs: input.finalizationMs,
    totalMs: input.totalMs != null ? input.totalMs : input.durationMs,
    lastCompletedPhase: input.lastCompletedPhase,
    pendingOperation: input.pendingOperation,
    timeoutReason: input.timeoutReason,
    terminalStatus:
      input.terminalStatus ??
      deriveCoachTerminalStatus({
        cancelled: input.cancelled,
        timedOut: input.timedOut,
        deliveryCommitted: input.deliveryCommitted,
        requestedLegCount: input.requestedLegCount,
        returnedLegCount: input.returnedLegCount,
        eventType: input.eventType,
        failureReason: input.failureReason,
      }),
    requestedSport: input.requestedSport ?? input.sportCategory,
    effectiveSports: input.effectiveSports,
    candidatesPoolBefore: input.candidatesPoolBefore,
    candidatesPoolAfter: input.candidatesPoolAfter,
    candidatesSelected: input.candidatesSelected,
    deepSimRequested: input.deepSimRequested,
    deepSimCompleted: input.deepSimCompleted,
    qualifiedCount: input.qualifiedCount,
  });
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
      updateId:
        body && typeof body.updateId === "string" ? body.updateId : input.updateId,
      terminalStatus:
        body && typeof body.terminalStatus === "string"
          ? body.terminalStatus
          : input.terminalStatus,
      totalMs:
        body && typeof body.totalMs === "number"
          ? body.totalMs
          : input.totalMs ?? input.durationMs,
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

    // Drop cancel/exception if this requestId already emitted a terminal outcome
    // (e.g. freeze then stop). Do not block late parlay_fulfilled after underfill.
    if (
      requestId &&
      terminalPostedRequestIds.has(requestId) &&
      (input.cancelled || body.eventType === "coach_exception")
    ) {
      logCoachRelDiagPostResult({
        correlationId,
        requestId,
        httpStatus: null,
        success: false,
        error: "terminal_deduped",
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

    if (requestId) terminalPostedRequestIds.add(requestId);

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


function withPerfTerminalStatus(
  body: Record<string, unknown>,
  input: CoachReliabilityReportInput,
): Record<string, unknown> {
  const status = deriveCoachTerminalStatus({
    cancelled: input.cancelled,
    timedOut: input.timedOut,
    deliveryCommitted: input.deliveryCommitted,
    requestedLegCount: input.requestedLegCount,
    returnedLegCount: input.returnedLegCount,
    eventType: typeof body.eventType === "string" ? body.eventType : input.eventType,
    failureReason:
      typeof body.failureReason === "string" ? body.failureReason : input.failureReason,
  });
  body.terminalStatus = status;
  if (!body.updateId) {
    const id = resolveCoachClientUpdateId();
    if (id) body.updateId = id;
  }
  return body;
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
  const finish = (body: Record<string, unknown>) =>
    withPerfTerminalStatus({ ...body }, input);

  const fullQualifiedTicket =
    requested != null &&
    returned != null &&
    returned > 0 &&
    returned >= requested;

  // User cancel / stop — never parlay_fulfilled, even with a full buffer.
  if (input.cancelled) {
    return finish({
      eventType: "coach_cancelled",
      failureReason: "cancelled",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? input.totalMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "request_cancelled",
      rootCauseGrade: "verified",
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    });
  }

  // Thrown mid-build — before shortfall/timeout classification (observe-only).
  if (
    input.eventType === "coach_exception" ||
    input.failureReason === "exception"
  ) {
    return finish({
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
      rootCause: input.rootCause ?? "build_exception",
      rootCauseGrade: "verified",
      ...timing,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    });
  }

  // Timeout / missing scan — only when a full ticket was not already assembled.
  // Freeze detail must include evidence-supported phase (not opaque ~180s label).
  if ((input.scanMissing || input.timedOut) && !fullQualifiedTicket) {
    const detail = input.scanMissing
      ? "board scan missing"
      : input.timeoutReason
        ? `deadline:${input.timeoutReason}`
        : "delivery budget / freeze";
    return finish({
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
    });
  }

  // Player/team/game mismatch on any returned selection → grounding (Telegram).
  // Must win over fulfillment / thin-slate / scan underfill classification.
  if (grounding.hasMismatch) {
    return finish({
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
    });
  }

  // Complete qualified ticket committed for delivery — sole success path.
  if (fullQualifiedTicket && input.deliveryCommitted) {
    return finish({
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
    });
  }

  // Assembled full ticket without UI commit — not success (and not freeze).
  if (fullQualifiedTicket && !input.deliveryCommitted) {
    return null;
  }

  if (input.scanFailureCode) {
    const mapped = mapScanFailureCode(String(input.scanFailureCode));
    if (!mapped) return null;
    return finish({
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
    });
  }

  // Shortfall with every returned selection grounded → legitimate underfill (digest).
  if (
    requested != null &&
    returned != null &&
    returned > 0 &&
    returned < requested
  ) {
    return finish({
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
    });
  }

  if (requested != null && returned === 0) {
    const blocked =
      input.failureReason === "blocked_unvalidated_market" ||
      input.scanFailureCode === "P0_UNVALIDATED_MARKETS";
    return finish({
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
    });
  }

  if (input.eventType) {
    return finish({
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
    });
  }

  return null;
}
