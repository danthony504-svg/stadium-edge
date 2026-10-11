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
};

/**
 * Classify + report a completed board scan / parlay build outcome.
 * Never throws. No-ops in Node tests / CI (same gate as crash reporter).
 */
export function reportCoachScanReliability(
  input: CoachReliabilityReportInput,
): void {
  try {
    if (!shouldSendCrashReports()) return;
    if (inFlight >= MAX_IN_FLIGHT) return;

    const body = buildCoachReliabilityBody(input);
    if (!body) return;

    inFlight += 1;
    void (async () => {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), REPORT_TIMEOUT_MS);
        try {
          await fetch(`${API_BASE}/reliability/coach-events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ac.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Fail soft — never retry, never surface to Coach UI.
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

  if (input.scanMissing || input.timedOut) {
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
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  return null;
}
