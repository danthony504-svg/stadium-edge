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

  // Full qualifying ticket already delivered: budget-race / missing-scan flags are
  // alert labels only — do not page ABSOLUTE_BUDGET / "delivery budget / freeze".
  // Fall through so grounding / underfill / success (null) classify from picks.
  const fullTicketDelivered =
    requested != null &&
    returned != null &&
    returned > 0 &&
    returned >= requested;

  if ((input.scanMissing || input.timedOut) && !fullTicketDelivered) {
    return {
      scanFailureCode: input.scanMissing ? "SCAN_THREW" : "ABSOLUTE_BUDGET",
      scanFailureDetail: input.scanMissing
        ? "board scan missing"
        : "delivery budget / freeze",
      sportCategory: input.sportCategory ?? "unspecified",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? null,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  // Player/team/game mismatch on any returned selection → grounding (Telegram).
  // Must win over thin-slate / scan underfill classification.
  if (grounding.hasMismatch) {
    return {
      eventType: "coach_grounding_failure",
      failureReason: "grounding_failure",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: returned ?? 0,
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      qualificationFiltersEliminated: false,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "player_game_grounding_mismatch",
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? input.scanFailureDetail ?? null,
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      qualificationFiltersEliminated: true,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "thin_slate_or_quality_bar",
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  if (requested != null && returned === 0) {
    return {
      eventType: "parlay_zero_results",
      failureReason:
        input.realOddsAvailable === false ? "odds_mismatch" : "zero_results",
      sportCategory: input.sportCategory ?? "unspecified",
      questionKind: "parlay_build",
      requestedLegCount: requested,
      returnedLegCount: 0,
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "zero_results",
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? null,
      ...corr,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  return null;
}
