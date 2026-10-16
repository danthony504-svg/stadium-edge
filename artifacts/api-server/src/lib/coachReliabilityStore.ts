/**
 * Persist Coach fulfillment / integrity reliability events into reliability_events
 * and page Telegram for alertable outcomes (shared fingerprint dedupe).
 *
 * Observe-only — never changes Coach selection / odds / sim behavior.
 */

import { and, eq, gt } from "drizzle-orm";
import { db, reliabilityEventsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { CRASH_DEDUPE_WINDOW_MS } from "./reliabilitySanitize.js";
import {
  appendDurationSample,
  coachAlertFingerprint,
  coachEventSummary,
  failureCategoryFor,
  parseCoachMeta,
  serializeCoachMeta,
  shouldAlertCoachEvent,
  type CoachEventType,
  type CoachFailureCategory,
  type CoachFailureReason,
  type CoachQuestionKind,
  type CoachReliabilityMeta,
  type CoachSportCategory,
} from "./coachReliabilitySanitize.js";
import {
  aggregateCoachDigestStats,
  type CoachDigestStats,
} from "./coachReliabilityDigest.js";
import {
  formatCoachReliabilityAlert,
  sendTelegramMessage,
  shouldSendCriticalTelegram,
} from "./telegramAlert.js";

export type { CoachDigestStats } from "./coachReliabilityDigest.js";
export { aggregateCoachDigestStats } from "./coachReliabilityDigest.js";

export type RecordCoachEventInput = {
  eventType: CoachEventType;
  sportCategory?: CoachSportCategory;
  questionKind?: CoachQuestionKind;
  requestedLegCount?: number | null;
  returnedLegCount?: number | null;
  durationMs?: number | null;
  failureReason?: CoachFailureReason;
  failureCategory?: CoachFailureCategory;
  realOddsAvailable?: boolean | null;
  qualificationFiltersEliminated?: boolean | null;
  answered?: boolean | null;
  requestId?: string | null;
  affectedGame?: string | null;
  rootCause?: string | null;
  /**
   * Temporary client↔server correlation id for coach-events diagnostics.
   * Logged only — not used in fingerprint / classification / Telegram rules.
   */
  correlationId?: string | null;
};

function buildMeta(input: RecordCoachEventInput): CoachReliabilityMeta {
  const failureReason = input.failureReason ?? "none";
  const eventType = input.eventType;
  return {
    eventType,
    sportCategory: input.sportCategory ?? "unspecified",
    questionKind: input.questionKind ?? "general_qa",
    requestedLegCount:
      typeof input.requestedLegCount === "number" ? input.requestedLegCount : null,
    returnedLegCount:
      typeof input.returnedLegCount === "number" ? input.returnedLegCount : null,
    durationMs: typeof input.durationMs === "number" ? input.durationMs : null,
    failureReason,
    failureCategory:
      input.failureCategory ?? failureCategoryFor(eventType, failureReason),
    realOddsAvailable:
      typeof input.realOddsAvailable === "boolean" ? input.realOddsAvailable : null,
    qualificationFiltersEliminated:
      typeof input.qualificationFiltersEliminated === "boolean"
        ? input.qualificationFiltersEliminated
        : null,
    answered: typeof input.answered === "boolean" ? input.answered : null,
    requestId: typeof input.requestId === "string" ? input.requestId : null,
    affectedGame: typeof input.affectedGame === "string" ? input.affectedGame : null,
    rootCause: typeof input.rootCause === "string" ? input.rootCause : null,
  };
}

async function sendCoachAlertIfAllowed(opts: {
  meta: CoachReliabilityMeta;
  fingerprint: string;
  lastAlertedAt: Date | null | undefined;
  now: Date;
  rowId: number;
  occurrenceCount: number;
}): Promise<boolean> {
  if (!shouldAlertCoachEvent(opts.meta)) return false;
  if (
    !shouldSendCriticalTelegram({
      lastAlertedAt: opts.lastAlertedAt,
      nowMs: opts.now.getTime(),
      dedupeWindowMs: CRASH_DEDUPE_WINDOW_MS,
    })
  ) {
    return false;
  }
  const sent = await sendTelegramMessage(
    formatCoachReliabilityAlert({
      eventType: opts.meta.eventType,
      summary: coachEventSummary(opts.meta),
      sportCategory: opts.meta.sportCategory,
      requestedLegCount: opts.meta.requestedLegCount,
      returnedLegCount: opts.meta.returnedLegCount,
      durationMs: opts.meta.durationMs,
      failureReason: opts.meta.failureReason,
      failureCategory: opts.meta.failureCategory,
      realOddsAvailable: opts.meta.realOddsAvailable,
      qualificationFiltersEliminated: opts.meta.qualificationFiltersEliminated,
      requestId: opts.meta.requestId,
      affectedGame: opts.meta.affectedGame,
      rootCause: opts.meta.rootCause,
      occurrenceCount: opts.occurrenceCount,
    }),
  );
  const alerted = sent.ok === true && sent.skipped !== true;
  if (alerted) {
    await db
      .update(reliabilityEventsTable)
      .set({ lastAlertedAt: opts.now })
      .where(eq(reliabilityEventsTable.id, opts.rowId));
  }
  return alerted;
}

function logCoachRelDiagServer(opts: {
  correlationId: string | null;
  requestId: string | null;
  eventType: string;
  failureReason: string;
  failureCategory: string;
  affectedGame: string | null;
  telegramEligible: boolean;
  dedupeSuppressed: boolean;
  alerted: boolean;
}): void {
  // Temporary diagnostics for /reliability/coach-events — no secrets / PII.
  logger.info(
    {
      correlationId: opts.correlationId,
      requestId: opts.requestId,
      eventType: opts.eventType,
      failureReason: opts.failureReason,
      failureCategory: opts.failureCategory,
      affectedGame: opts.affectedGame,
      telegramEligible: opts.telegramEligible,
      dedupeSuppressed: opts.dedupeSuppressed,
      alerted: opts.alerted,
    },
    "[coach-rel-diag] coach-event",
  );
}

/**
 * Record a Coach reliability event. Fail-soft — never throws to Coach routes.
 */
export async function recordCoachReliabilityEvent(
  input: RecordCoachEventInput,
  now = new Date(),
): Promise<{ accepted: boolean; alerted: boolean; deduped: boolean }> {
  try {
    const meta = buildMeta(input);
    const fingerprint = coachAlertFingerprint(meta);
    const summary = coachEventSummary(meta);
    const windowStart = new Date(now.getTime() - CRASH_DEDUPE_WINDOW_MS);
    const telegramEligible = shouldAlertCoachEvent(meta);
    const correlationId =
      typeof input.correlationId === "string" ? input.correlationId : null;

    const existing = await db
      .select()
      .from(reliabilityEventsTable)
      .where(
        and(
          eq(reliabilityEventsTable.fingerprint, fingerprint),
          gt(reliabilityEventsTable.updatedAt, windowStart),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const row = existing[0];
      const prevMeta = parseCoachMeta(row.errorStack);
      const samples = appendDurationSample(prevMeta, meta.durationMs);
      const nextMeta: CoachReliabilityMeta = {
        ...meta,
        durationSamples: samples,
      };
      const nextCount = (row.occurrenceCount ?? 1) + 1;
      await db
        .update(reliabilityEventsTable)
        .set({
          occurrenceCount: nextCount,
          updatedAt: now,
          errorMessage: summary,
          errorStack: serializeCoachMeta(nextMeta),
        })
        .where(eq(reliabilityEventsTable.id, row.id));

      const alerted = await sendCoachAlertIfAllowed({
        meta: nextMeta,
        fingerprint,
        lastAlertedAt: row.lastAlertedAt,
        now,
        rowId: row.id,
        occurrenceCount: nextCount,
      });
      // Fingerprint hit in window = dedupe suppressed (even if Telegram-eligible).
      logCoachRelDiagServer({
        correlationId,
        requestId: meta.requestId,
        eventType: meta.eventType,
        failureReason: meta.failureReason,
        failureCategory: meta.failureCategory,
        affectedGame: meta.affectedGame,
        telegramEligible,
        dedupeSuppressed: true,
        alerted,
      });
      return { accepted: true, alerted, deduped: true };
    }

    const samples = appendDurationSample(null, meta.durationMs);
    const inserted = await db
      .insert(reliabilityEventsTable)
      .values({
        fingerprint,
        severity: "coach",
        errorMessage: summary,
        errorStack: serializeCoachMeta({ ...meta, durationSamples: samples }),
        componentStack: null,
        updateId: "server",
        runtimeVersion: "api",
        channel: "api",
        appVersion: "api",
        bundleSource: "server",
        platform: "server",
        sessionId: null,
        clientTs: now,
        occurrenceCount: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: reliabilityEventsTable.id });

    const id = inserted[0]?.id;
    if (id == null) {
      logCoachRelDiagServer({
        correlationId,
        requestId: meta.requestId,
        eventType: meta.eventType,
        failureReason: meta.failureReason,
        failureCategory: meta.failureCategory,
        affectedGame: meta.affectedGame,
        telegramEligible,
        dedupeSuppressed: false,
        alerted: false,
      });
      return { accepted: true, alerted: false, deduped: false };
    }

    const alerted = await sendCoachAlertIfAllowed({
      meta: { ...meta, durationSamples: samples },
      fingerprint,
      lastAlertedAt: null,
      now,
      rowId: id,
      occurrenceCount: 1,
    });
    // New fingerprint: quiet-window skip still counts as dedupe-suppressed for diag.
    const dedupeSuppressed = telegramEligible && !alerted;
    logCoachRelDiagServer({
      correlationId,
      requestId: meta.requestId,
      eventType: meta.eventType,
      failureReason: meta.failureReason,
      failureCategory: meta.failureCategory,
      affectedGame: meta.affectedGame,
      telegramEligible,
      dedupeSuppressed,
      alerted,
    });
    return { accepted: true, alerted, deduped: false };
  } catch (err) {
    logger.warn({ err }, "coach reliability event store failed");
    try {
      const meta = buildMeta(input);
      logCoachRelDiagServer({
        correlationId:
          typeof input.correlationId === "string" ? input.correlationId : null,
        requestId: meta.requestId,
        eventType: meta.eventType,
        failureReason: meta.failureReason,
        failureCategory: meta.failureCategory,
        affectedGame: meta.affectedGame,
        telegramEligible: shouldAlertCoachEvent(meta),
        dedupeSuppressed: false,
        alerted: false,
      });
    } catch {
      /* ignore diag failure */
    }
    return { accepted: false, alerted: false, deduped: false };
  }
}

/** Fire-and-forget wrapper for route handlers. */
export function reportCoachReliability(input: RecordCoachEventInput): void {
  void recordCoachReliabilityEvent(input).catch(() => {
    /* already fail-soft inside */
  });
}

export async function coachReliabilityDigestStats(
  windowHours = 24,
  now = new Date(),
): Promise<CoachDigestStats> {
  const empty: CoachDigestStats = {
    windowHours,
    totalRequests: 0,
    successfulRequests: 0,
    fulfillmentPct: null,
    underfillCount: 0,
    legitimateUnderfillCount: 0,
    zeroResultCount: 0,
    questionFailureCount: 0,
    groundingFailureCount: 0,
    altMarketFailureCount: 0,
    simulationFailureCount: 0,
    scanFreezeCount: 0,
    unknownOutcomeCount: 0,
    p50Ms: null,
    p95Ms: null,
    topFailureReasons: [],
  };
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        fingerprint: reliabilityEventsTable.fingerprint,
        errorStack: reliabilityEventsTable.errorStack,
        occurrenceCount: reliabilityEventsTable.occurrenceCount,
      })
      .from(reliabilityEventsTable)
      .where(
        and(
          eq(reliabilityEventsTable.subsystem, "coach"),
          gt(reliabilityEventsTable.updatedAt, since),
        ),
      );

    return aggregateCoachDigestStats(
      rows.map((row) => ({
        meta: parseCoachMeta(row.errorStack),
        occurrenceCount: row.occurrenceCount ?? 1,
      })),
      windowHours,
    );
  } catch (err) {
    logger.warn({ err }, "coach reliability digest stats failed");
    return empty;
  }
}

/** Pure helper for unit tests — sum occurrence counts by event type. */
export function sumCoachOccurrences(
  rows: Array<{ eventType: CoachEventType; occurrenceCount: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.eventType] = (out[r.eventType] ?? 0) + (r.occurrenceCount || 0);
  }
  return out;
}
