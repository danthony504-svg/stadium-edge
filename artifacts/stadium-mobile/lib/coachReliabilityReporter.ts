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

export type CoachReliabilityRequestScope = {
  sport?: string | null;
  team?: string | null;
  /** High-level ask class only — never raw user text. */
  kind?: string | null;
};

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
   * True only after a complete, qualified ticket is latched for UI delivery
   * (finishSession / late-accept / full-buffer absolute terminal). Required to
   * count `parlay_fulfilled` — assembly alone is not success.
   */
  deliveryCommitted?: boolean;
  /**
   * User stop / abort — never counts as delivery success, even with a full
   * buffered ticket. Replaces underfill/timeout/zero classification.
   */
  cancelled?: boolean;
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
  /** Expo OTA update id when available (no credentials). */
  updateId?: string | null;
  /** Expo channel (production / preview / …). */
  channel?: string | null;
  /** Baked git SHA from EXPO_PUBLIC_GIT_COMMIT. */
  bakedSha?: string | null;
  /** Team/sport scope for the ask — never raw user text. */
  requestScope?: CoachReliabilityRequestScope | null;
  /** Sanitized candidate fingerprints (game|market|pick), capped. */
  candidateIds?: readonly string[] | null;
  /** Distinct game labels on the ticket / slate, capped. */
  gameIds?: readonly string[] | null;
  /** Scan/sim failure code (same vocabulary as scanFailureCode). */
  simFailureReason?: string | null;
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

async function resolveReliabilityOtaFields(): Promise<{
  updateId: string | null;
  channel: string | null;
  bakedSha: string | null;
}> {
  const bakedSha =
    (typeof process !== "undefined" &&
      process.env?.EXPO_PUBLIC_GIT_COMMIT &&
      String(process.env.EXPO_PUBLIC_GIT_COMMIT).trim()) ||
    null;
  try {
    const Updates = await import("expo-updates");
    let channelHeader: string | undefined;
    try {
      const Constants = (await import("expo-constants")).default;
      const hdr =
        Constants?.expoConfig?.updates?.requestHeaders?.["expo-channel-name"];
      if (typeof hdr === "string" && hdr.trim()) channelHeader = hdr.trim();
    } catch {
      // optional
    }
    const isEmbeddedLaunch = !!Updates.isEmbeddedLaunch;
    return {
      updateId: Updates.updateId
        ? String(Updates.updateId)
        : isEmbeddedLaunch
          ? "embedded"
          : null,
      channel:
        (Updates.channel && String(Updates.channel)) || channelHeader || null,
      bakedSha,
    };
  } catch {
    return { updateId: null, channel: null, bakedSha };
  }
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

    // Sync body first (tests + diag); OTA fields filled before POST when missing.
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
        const ota = await resolveReliabilityOtaFields();
        const postBody = buildCoachReliabilityBody({
          ...input,
          correlationId,
          updateId: input.updateId ?? ota.updateId,
          channel: input.channel ?? ota.channel,
          bakedSha: input.bakedSha ?? ota.bakedSha,
        });
        if (!postBody) {
          logCoachRelDiagPostResult({
            correlationId,
            requestId,
            httpStatus: null,
            success: false,
            error: "no_body",
          });
          return;
        }
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), REPORT_TIMEOUT_MS);
        try {
          const res = await fetch(`${API_BASE}/reliability/coach-events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(postBody),
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

/** Sanitize enrichment fields — never credentials, emails, or raw ask text. */
export function reliabilityEnrichmentFields(
  input: CoachReliabilityReportInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const updateId =
    (input.updateId && String(input.updateId).trim()) ||
    null;
  const channel =
    (input.channel && String(input.channel).trim()) ||
    null;
  const bakedSha =
    (input.bakedSha && String(input.bakedSha).trim()) ||
    (typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_GIT_COMMIT &&
    String(process.env.EXPO_PUBLIC_GIT_COMMIT).trim()) ||
    null;
  if (updateId) out.updateId = String(updateId).slice(0, 120);
  if (channel) out.channel = String(channel).slice(0, 40);
  if (bakedSha) out.bakedSha = String(bakedSha).slice(0, 64);

  if (input.requestScope && typeof input.requestScope === "object") {
    const scope: Record<string, string> = {};
    if (input.requestScope.sport) {
      scope.sport = String(input.requestScope.sport).slice(0, 40);
    }
    if (input.requestScope.team) {
      scope.team = String(input.requestScope.team).slice(0, 80);
    }
    if (input.requestScope.kind) {
      scope.kind = String(input.requestScope.kind).slice(0, 40);
    }
    if (Object.keys(scope).length) out.requestScope = scope;
  }

  if (Array.isArray(input.candidateIds) && input.candidateIds.length) {
    out.candidateIds = input.candidateIds
      .map((s) => String(s ?? "").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 24);
  }
  if (Array.isArray(input.gameIds) && input.gameIds.length) {
    out.gameIds = input.gameIds
      .map((s) => String(s ?? "").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 12);
  }

  const simReason =
    (input.simFailureReason && String(input.simFailureReason).trim()) ||
    (input.scanFailureCode && String(input.scanFailureCode).trim()) ||
    null;
  if (simReason) out.simFailureReason = simReason.slice(0, 80);

  return out;
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
  const enrich = reliabilityEnrichmentFields(input);

  // Full qualifying ticket: budget-race / missing-scan flags are alert labels only —
  // do not page ABSOLUTE_BUDGET / "delivery budget / freeze". Success still requires
  // deliveryCommitted (ticket latched for UI).
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "user_cancelled",
      ...corr,
      ...enrich,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  if ((input.scanMissing || input.timedOut) && !fullQualifiedTicket) {
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
      ...enrich,
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      qualificationFiltersEliminated: false,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? "player_game_grounding_mismatch",
      ...corr,
      ...enrich,
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? null,
      ...corr,
      ...enrich,
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
      durationMs: input.durationMs ?? null,
      realOddsAvailable: input.realOddsAvailable ?? null,
      requestId: input.requestId ?? null,
      affectedGame,
      rootCause: input.rootCause ?? input.scanFailureDetail ?? null,
      ...corr,
      ...enrich,
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
      ...enrich,
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
      ...enrich,
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
      ...enrich,
      ...(input.testFixture ? { testFixture: true } : {}),
    };
  }

  return null;
}
