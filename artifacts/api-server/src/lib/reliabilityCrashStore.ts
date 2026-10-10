/**
 * Persist + dedupe crash events. Fail-soft when the table is missing
 * (migration not applied yet) so ingest never destabilizes the API.
 *
 * Telegram alerts require a successful shared (PostgreSQL) dedupe path.
 * Database failures suppress alerts rather than risk a notification storm.
 */

import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, reliabilityEventsTable } from "@workspace/db";
import { logger } from "./logger.js";
import {
  CRASH_DEDUPE_WINDOW_MS,
  CRASH_RETENTION_MS,
  type SanitizedCrashEvent,
} from "./reliabilitySanitize.js";
import { allowTelegramWithoutSharedDedupe } from "./reliabilityPolicy.js";
import {
  formatCriticalCrashAlert,
  sendTelegramMessage,
  shouldSendCriticalTelegram,
} from "./telegramAlert.js";

export type IngestOutcome = {
  accepted: boolean;
  deduped: boolean;
  alerted: boolean;
  shed?: boolean;
  id?: number;
};

export { allowTelegramWithoutSharedDedupe } from "./reliabilityPolicy.js";

async function sendCriticalAlertIfAllowed(opts: {
  fingerprint: string;
  errorMessage: string;
  updateId: string;
  runtimeVersion: string;
  channel: string;
  appVersion: string;
  platform: string;
  occurrenceCount?: number;
  lastAlertedAt: Date | null | undefined;
  now: Date;
  rowId: number;
  sharedDedupeAvailable: boolean;
}): Promise<boolean> {
  if (!opts.sharedDedupeAvailable) return false;
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
    formatCriticalCrashAlert({
      fingerprint: opts.fingerprint,
      errorMessage: opts.errorMessage,
      updateId: opts.updateId,
      runtimeVersion: opts.runtimeVersion,
      channel: opts.channel,
      appVersion: opts.appVersion,
      platform: opts.platform,
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

export async function ingestSanitizedCrash(
  event: SanitizedCrashEvent,
  now = new Date(),
): Promise<IngestOutcome> {
  try {
    const windowStart = new Date(now.getTime() - CRASH_DEDUPE_WINDOW_MS);
    const existing = await db
      .select()
      .from(reliabilityEventsTable)
      .where(
        and(
          eq(reliabilityEventsTable.fingerprint, event.fingerprint),
          gt(reliabilityEventsTable.updatedAt, windowStart),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const row = existing[0];
      const nextCount = (row.occurrenceCount ?? 1) + 1;
      await db
        .update(reliabilityEventsTable)
        .set({
          occurrenceCount: nextCount,
          updatedAt: now,
          errorMessage: event.errorMessage,
          errorStack: event.errorStack || row.errorStack,
        })
        .where(eq(reliabilityEventsTable.id, row.id));

      const alerted = await sendCriticalAlertIfAllowed({
        fingerprint: event.fingerprint,
        errorMessage: event.errorMessage,
        updateId: event.updateId,
        runtimeVersion: event.runtimeVersion,
        channel: event.channel,
        appVersion: event.appVersion,
        platform: event.platform,
        occurrenceCount: nextCount,
        lastAlertedAt: row.lastAlertedAt,
        now,
        rowId: row.id,
        sharedDedupeAvailable: true,
      });
      return { accepted: true, deduped: true, alerted, id: row.id };
    }

    const inserted = await db
      .insert(reliabilityEventsTable)
      .values({
        fingerprint: event.fingerprint,
        severity: event.severity,
        errorMessage: event.errorMessage,
        errorStack: event.errorStack || null,
        componentStack: event.componentStack || null,
        updateId: event.updateId,
        runtimeVersion: event.runtimeVersion,
        channel: event.channel,
        appVersion: event.appVersion,
        bundleSource: event.bundleSource,
        platform: event.platform,
        sessionId: event.sessionId,
        clientTs: event.clientTs,
        occurrenceCount: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: reliabilityEventsTable.id });

    const id = inserted[0]?.id;
    if (id == null) {
      // Insert succeeded but no id — treat as accepted without alert (no durable key).
      return { accepted: true, deduped: false, alerted: false };
    }

    const alerted = await sendCriticalAlertIfAllowed({
      fingerprint: event.fingerprint,
      errorMessage: event.errorMessage,
      updateId: event.updateId,
      runtimeVersion: event.runtimeVersion,
      channel: event.channel,
      appVersion: event.appVersion,
      platform: event.platform,
      occurrenceCount: 1,
      lastAlertedAt: null,
      now,
      rowId: id,
      sharedDedupeAvailable: true,
    });
    return { accepted: true, deduped: false, alerted, id };
  } catch (err) {
    logger.warn({ err }, "reliability crash ingest store failed");
    // Suppress Telegram when shared dedupe is unavailable (DB down / missing table).
    if (allowTelegramWithoutSharedDedupe()) {
      // Intentionally unreachable — kept for policy clarity in tests.
    }
    return { accepted: false, deduped: false, alerted: false, shed: true };
  }
}

export async function pruneReliabilityEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CRASH_RETENTION_MS);
  try {
    const result = await db
      .delete(reliabilityEventsTable)
      .where(lt(reliabilityEventsTable.createdAt, cutoff));
    // drizzle node-pg may not return rowCount consistently — best-effort.
    const n = (result as { rowCount?: number })?.rowCount ?? 0;
    return typeof n === "number" ? n : 0;
  } catch (err) {
    logger.warn({ err }, "reliability prune failed");
    return 0;
  }
}

export async function reliabilityDigestStats(
  windowHours = 24,
  now = new Date(),
): Promise<{
  windowHours: number;
  criticalCount: number;
  distinctFingerprints: number;
  lastCriticalAt: string | null;
}> {
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        criticalCount: sql<number>`coalesce(sum(${reliabilityEventsTable.occurrenceCount}), 0)`,
        distinctFingerprints: sql<number>`count(distinct ${reliabilityEventsTable.fingerprint})`,
        lastCriticalAt: sql<Date | null>`max(${reliabilityEventsTable.updatedAt})`,
      })
      .from(reliabilityEventsTable)
      .where(gt(reliabilityEventsTable.updatedAt, since));
    const row = rows[0];
    const last = row?.lastCriticalAt;
    return {
      windowHours,
      criticalCount: Number(row?.criticalCount ?? 0),
      distinctFingerprints: Number(row?.distinctFingerprints ?? 0),
      lastCriticalAt: last ? new Date(last).toISOString() : null,
    };
  } catch (err) {
    logger.warn({ err }, "reliability digest stats failed");
    return {
      windowHours,
      criticalCount: 0,
      distinctFingerprints: 0,
      lastCriticalAt: null,
    };
  }
}
