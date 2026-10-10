/**
 * Persist Coach fulfillment / Q&A reliability events into reliability_events
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
  COACH_ALERT_EVENT_TYPES,
  coachAlertFingerprint,
  coachEventSummary,
  parseCoachMeta,
  percentile,
  serializeCoachMeta,
  type CoachEventType,
  type CoachFailureReason,
  type CoachQuestionKind,
  type CoachReliabilityMeta,
  type CoachSportCategory,
} from "./coachReliabilitySanitize.js";
import {
  formatCoachReliabilityAlert,
  sendTelegramMessage,
  shouldSendCriticalTelegram,
} from "./telegramAlert.js";

export type RecordCoachEventInput = {
  eventType: CoachEventType;
  sportCategory?: CoachSportCategory;
  questionKind?: CoachQuestionKind;
  requestedLegCount?: number | null;
  returnedLegCount?: number | null;
  durationMs?: number | null;
  failureReason?: CoachFailureReason;
  realOddsAvailable?: boolean | null;
  qualificationFiltersEliminated?: boolean | null;
  answered?: boolean | null;
};

export type CoachDigestStats = {
  windowHours: number;
  totalRequests: number;
  successfulRequests: number;
  fulfillmentPct: number | null;
  underfillCount: number;
  zeroResultCount: number;
  questionFailureCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  topFailureReasons: Array<{ reason: string; count: number }>;
};

function buildMeta(input: RecordCoachEventInput): CoachReliabilityMeta {
  return {
    eventType: input.eventType,
    sportCategory: input.sportCategory ?? "unspecified",
    questionKind: input.questionKind ?? "general_qa",
    requestedLegCount:
      typeof input.requestedLegCount === "number" ? input.requestedLegCount : null,
    returnedLegCount:
      typeof input.returnedLegCount === "number" ? input.returnedLegCount : null,
    durationMs: typeof input.durationMs === "number" ? input.durationMs : null,
    failureReason: input.failureReason ?? "none",
    realOddsAvailable:
      typeof input.realOddsAvailable === "boolean" ? input.realOddsAvailable : null,
    qualificationFiltersEliminated:
      typeof input.qualificationFiltersEliminated === "boolean"
        ? input.qualificationFiltersEliminated
        : null,
    answered: typeof input.answered === "boolean" ? input.answered : null,
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
  if (!COACH_ALERT_EVENT_TYPES.has(opts.meta.eventType)) return false;
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
      realOddsAvailable: opts.meta.realOddsAvailable,
      qualificationFiltersEliminated: opts.meta.qualificationFiltersEliminated,
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
    if (id == null) return { accepted: true, alerted: false, deduped: false };

    const alerted = await sendCoachAlertIfAllowed({
      meta: { ...meta, durationSamples: samples },
      fingerprint,
      lastAlertedAt: null,
      now,
      rowId: id,
      occurrenceCount: 1,
    });
    return { accepted: true, alerted, deduped: false };
  } catch (err) {
    logger.warn({ err }, "coach reliability event store failed");
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
    zeroResultCount: 0,
    questionFailureCount: 0,
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
          eq(reliabilityEventsTable.severity, "coach"),
          gt(reliabilityEventsTable.updatedAt, since),
        ),
      );

    let totalRequests = 0;
    let successfulRequests = 0;
    let underfillCount = 0;
    let zeroResultCount = 0;
    let questionFailureCount = 0;
    const reasonCounts = new Map<string, number>();
    const durations: number[] = [];

    for (const row of rows) {
      const n = row.occurrenceCount ?? 1;
      const meta = parseCoachMeta(row.errorStack);
      const type = meta?.eventType;
      if (!type) continue;

      if (
        type === "parlay_requested" ||
        type === "coach_question_received"
      ) {
        totalRequests += n;
      }
      if (type === "parlay_fulfilled") {
        successfulRequests += n;
      }
      if (type === "parlay_underfilled") underfillCount += n;
      if (type === "parlay_zero_results") zeroResultCount += n;
      if (
        type === "coach_question_failed" ||
        type === "coach_empty_response"
      ) {
        questionFailureCount += n;
      }
      if (
        meta?.failureReason &&
        meta.failureReason !== "none" &&
        COACH_ALERT_EVENT_TYPES.has(type)
      ) {
        reasonCounts.set(
          meta.failureReason,
          (reasonCounts.get(meta.failureReason) ?? 0) + n,
        );
      }
      const samples = meta?.durationSamples?.length
        ? meta.durationSamples
        : meta?.durationMs != null
          ? [meta.durationMs]
          : [];
      for (const d of samples) {
        if (typeof d === "number" && Number.isFinite(d)) durations.push(d);
      }
    }

    // If request markers were not emitted, approximate from outcomes.
    if (totalRequests === 0) {
      totalRequests =
        successfulRequests +
        underfillCount +
        zeroResultCount +
        questionFailureCount;
    }

    const parlayAttempts =
      successfulRequests + underfillCount + zeroResultCount;
    const fulfillmentPct =
      parlayAttempts > 0
        ? Math.round((1000 * successfulRequests) / parlayAttempts) / 10
        : null;

    durations.sort((a, b) => a - b);
    const topFailureReasons = [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      windowHours,
      totalRequests,
      successfulRequests,
      fulfillmentPct,
      underfillCount,
      zeroResultCount,
      questionFailureCount,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      topFailureReasons,
    };
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
