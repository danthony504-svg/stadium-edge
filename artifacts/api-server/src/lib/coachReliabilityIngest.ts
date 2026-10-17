/**
 * Sanitize public Coach reliability POSTs from the mobile client.
 * Rejects oversized / PII-looking payloads; never trusts client severity.
 */

import {
  COACH_EVENT_TYPES,
  failureCategoryFor,
  mapScanFailureCode,
  type CoachEventType,
  type CoachFailureReason,
  type CoachQuestionKind,
  type CoachSportCategory,
} from "./coachReliabilitySanitize.js";
import type { RecordCoachEventInput } from "./coachReliabilityStore.js";
import { sanitizeReliabilityText } from "./reliabilitySanitize.js";

const SPORT: ReadonlySet<string> = new Set([
  "nfl",
  "ncaaf",
  "nba",
  "wnba",
  "mlb",
  "nhl",
  "soccer",
  "ufc",
  "tennis",
  "multi",
  "unspecified",
]);

const KINDS: ReadonlySet<string> = new Set([
  "parlay_build",
  "live_qa",
  "roster_qa",
  "odds_qa",
  "injury_qa",
  "photo_qa",
  "general_qa",
]);

export const COACH_EVENT_MAX_BODY_BYTES = 8_192;

/** Known synthetic fixtures must never page production Telegram. */
const TEST_FIXTURE_REQUEST_IDS = new Set([
  "test-fixture",
  "startup-render-fail",
  "reliability-synthetic",
]);

export function isCoachReliabilityTestFixture(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const rid = String(b.requestId ?? "").toLowerCase();
  if (TEST_FIXTURE_REQUEST_IDS.has(rid)) return true;
  if (b.testFixture === true || b.synthetic === true) return true;
  const root = String(b.rootCause ?? "").toLowerCase();
  if (root.includes("synthetic-fixture")) return true;
  return false;
}

function parseCorrelationId(b: Record<string, unknown>): string | null {
  // Temporary client↔server match key for coach-events diagnostics only.
  if (typeof b.correlationId !== "string") return null;
  const s = sanitizeReliabilityText(b.correlationId, 80);
  return s || null;
}

function parseEnrichment(b: Record<string, unknown>): {
  updateId: string | null;
  channel: string | null;
  bakedSha: string | null;
  requestScope: RecordCoachEventInput["requestScope"];
  candidateIds: string[] | null;
  gameIds: string[] | null;
  simFailureReason: string | null;
} {
  const requestScopeRaw =
    b.requestScope && typeof b.requestScope === "object"
      ? (b.requestScope as Record<string, unknown>)
      : null;
  const requestScope = requestScopeRaw
    ? {
        sport:
          typeof requestScopeRaw.sport === "string"
            ? sanitizeReliabilityText(requestScopeRaw.sport, 40)
            : null,
        team:
          typeof requestScopeRaw.team === "string"
            ? sanitizeReliabilityText(requestScopeRaw.team, 80)
            : null,
        kind:
          typeof requestScopeRaw.kind === "string"
            ? sanitizeReliabilityText(requestScopeRaw.kind, 40)
            : null,
      }
    : null;
  const scopeOk =
    requestScope &&
    (requestScope.sport || requestScope.team || requestScope.kind)
      ? requestScope
      : null;

  const list = (v: unknown, max: number, len: number): string[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v
      .map((s) => sanitizeReliabilityText(String(s ?? ""), len))
      .filter(Boolean)
      .slice(0, max);
    return out.length ? out : null;
  };

  return {
    updateId:
      typeof b.updateId === "string"
        ? sanitizeReliabilityText(b.updateId, 120)
        : null,
    channel:
      typeof b.channel === "string"
        ? sanitizeReliabilityText(b.channel, 40)
        : null,
    bakedSha:
      typeof b.bakedSha === "string"
        ? sanitizeReliabilityText(b.bakedSha, 64)
        : null,
    requestScope: scopeOk,
    candidateIds: list(b.candidateIds, 24, 120),
    gameIds: list(b.gameIds, 12, 120),
    simFailureReason:
      typeof b.simFailureReason === "string"
        ? sanitizeReliabilityText(b.simFailureReason, 80)
        : typeof b.scanFailureCode === "string"
          ? sanitizeReliabilityText(b.scanFailureCode, 80)
          : null,
  };
}

export function parseCoachReliabilityIngestBody(
  body: unknown,
): RecordCoachEventInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const correlationId = parseCorrelationId(b);
  const enrich = parseEnrichment(b);

  // Prefer structured scan failure codes from mobile.
  if (typeof b.scanFailureCode === "string" && b.scanFailureCode) {
    const mapped = mapScanFailureCode(String(b.scanFailureCode));
    if (!mapped) return null;
    return {
      eventType: mapped.eventType,
      sportCategory: SPORT.has(String(b.sportCategory))
        ? (String(b.sportCategory) as CoachSportCategory)
        : "unspecified",
      questionKind: "parlay_build",
      requestedLegCount:
        typeof b.requestedLegCount === "number" ? b.requestedLegCount : null,
      returnedLegCount:
        typeof b.returnedLegCount === "number" ? b.returnedLegCount : null,
      durationMs: typeof b.durationMs === "number" ? b.durationMs : null,
      failureReason: mapped.failureReason,
      failureCategory: failureCategoryFor(mapped.eventType, mapped.failureReason),
      realOddsAvailable:
        typeof b.realOddsAvailable === "boolean" ? b.realOddsAvailable : null,
      qualificationFiltersEliminated:
        typeof b.qualificationFiltersEliminated === "boolean"
          ? b.qualificationFiltersEliminated
          : null,
      requestId:
        typeof b.requestId === "string"
          ? sanitizeReliabilityText(b.requestId, 80)
          : null,
      affectedGame:
        typeof b.affectedGame === "string"
          ? sanitizeReliabilityText(b.affectedGame, 120)
          : null,
      rootCause: sanitizeReliabilityText(
        typeof b.rootCause === "string"
          ? b.rootCause
          : typeof b.scanFailureDetail === "string"
            ? b.scanFailureDetail
            : mapped.failureReason,
        240,
      ),
      correlationId,
      ...enrich,
    };
  }

  const eventType = String(b.eventType ?? "") as CoachEventType;
  if (!COACH_EVENT_TYPES.includes(eventType)) return null;

  const failureReason = (String(b.failureReason ?? "unknown") ||
    "unknown") as CoachFailureReason;

  return {
    eventType,
    sportCategory: SPORT.has(String(b.sportCategory))
      ? (String(b.sportCategory) as CoachSportCategory)
      : "unspecified",
    questionKind: KINDS.has(String(b.questionKind))
      ? (String(b.questionKind) as CoachQuestionKind)
      : "general_qa",
    requestedLegCount:
      typeof b.requestedLegCount === "number" ? b.requestedLegCount : null,
    returnedLegCount:
      typeof b.returnedLegCount === "number" ? b.returnedLegCount : null,
    durationMs: typeof b.durationMs === "number" ? b.durationMs : null,
    failureReason,
    failureCategory: failureCategoryFor(eventType, failureReason),
    realOddsAvailable:
      typeof b.realOddsAvailable === "boolean" ? b.realOddsAvailable : null,
    qualificationFiltersEliminated:
      typeof b.qualificationFiltersEliminated === "boolean"
        ? b.qualificationFiltersEliminated
        : null,
    answered: typeof b.answered === "boolean" ? b.answered : null,
    requestId:
      typeof b.requestId === "string"
        ? sanitizeReliabilityText(b.requestId, 80)
        : null,
    affectedGame:
      typeof b.affectedGame === "string"
        ? sanitizeReliabilityText(b.affectedGame, 120)
        : null,
    rootCause:
      typeof b.rootCause === "string"
        ? sanitizeReliabilityText(b.rootCause, 240)
        : null,
    correlationId,
    ...enrich,
  };
}
