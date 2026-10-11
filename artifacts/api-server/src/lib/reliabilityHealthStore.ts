/**
 * Persist 90-minute health check outcomes, Telegram fail/recovery alerts,
 * and fingerprint dedupe (shared reliability_events table).
 */

import { and, eq, gt } from "drizzle-orm";
import { db, reliabilityEventsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { CRASH_DEDUPE_WINDOW_MS } from "./reliabilitySanitize.js";
import {
  runReliabilityHealthChecks,
  summarizeHealthChecks,
  type HealthCheckEnv,
  type HealthCheckId,
  type HealthCheckResult,
} from "./reliabilityHealthChecks.js";
import {
  formatHealthFailureAlert,
  formatHealthRecoveryAlert,
  sendTelegramMessage,
  shouldSendCriticalTelegram,
} from "./telegramAlert.js";

export type HealthRunOutcome = {
  ok: boolean;
  checks: HealthCheckResult[];
  failed: HealthCheckId[];
  passed: HealthCheckId[];
  alerted: HealthCheckId[];
  recovered: HealthCheckId[];
  deduped: HealthCheckId[];
};

function failFingerprint(id: HealthCheckId): string {
  return `health|${id}|fail`;
}

function serializeCheck(check: HealthCheckResult, status: "fail" | "ok"): string {
  return JSON.stringify({
    kind: "health",
    status,
    id: check.id,
    detail: String(check.detail ?? "").slice(0, 240),
    latencyMs: check.latencyMs,
    httpStatus: check.httpStatus ?? null,
  }).slice(0, 1800);
}

async function alertFailure(opts: {
  check: HealthCheckResult;
  now: Date;
}): Promise<"alerted" | "deduped" | "skipped"> {
  const fingerprint = failFingerprint(opts.check.id);
  const windowStart = new Date(opts.now.getTime() - CRASH_DEDUPE_WINDOW_MS);
  try {
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
      const nextCount = (row.occurrenceCount ?? 1) + 1;
      await db
        .update(reliabilityEventsTable)
        .set({
          occurrenceCount: nextCount,
          updatedAt: opts.now,
          errorMessage: `health fail: ${opts.check.id}`,
          errorStack: serializeCheck(opts.check, "fail"),
        })
        .where(eq(reliabilityEventsTable.id, row.id));

      if (
        !shouldSendCriticalTelegram({
          lastAlertedAt: row.lastAlertedAt,
          nowMs: opts.now.getTime(),
          dedupeWindowMs: CRASH_DEDUPE_WINDOW_MS,
        })
      ) {
        return "deduped";
      }
      const sent = await sendTelegramMessage(
        formatHealthFailureAlert({
          checkId: opts.check.id,
          detail: opts.check.detail,
          latencyMs: opts.check.latencyMs,
          httpStatus: opts.check.httpStatus,
          occurrenceCount: nextCount,
        }),
      );
      if (sent.ok && sent.skipped !== true) {
        await db
          .update(reliabilityEventsTable)
          .set({ lastAlertedAt: opts.now })
          .where(eq(reliabilityEventsTable.id, row.id));
        return "alerted";
      }
      return "skipped";
    }

    const inserted = await db
      .insert(reliabilityEventsTable)
      .values({
        fingerprint,
        severity: "health",
        errorMessage: `health fail: ${opts.check.id}`,
        errorStack: serializeCheck(opts.check, "fail"),
        updateId: "server",
        runtimeVersion: "api",
        channel: "api",
        appVersion: "api",
        bundleSource: "server",
        platform: "server",
        occurrenceCount: 1,
        createdAt: opts.now,
        updatedAt: opts.now,
      })
      .returning({ id: reliabilityEventsTable.id });

    const id = inserted[0]?.id;
    if (id == null) return "skipped";

    const sent = await sendTelegramMessage(
      formatHealthFailureAlert({
        checkId: opts.check.id,
        detail: opts.check.detail,
        latencyMs: opts.check.latencyMs,
        httpStatus: opts.check.httpStatus,
        occurrenceCount: 1,
      }),
    );
    if (sent.ok && sent.skipped !== true) {
      await db
        .update(reliabilityEventsTable)
        .set({ lastAlertedAt: opts.now })
        .where(eq(reliabilityEventsTable.id, id));
      return "alerted";
    }
    return "skipped";
  } catch (err) {
    logger.warn({ err, check: opts.check.id }, "health failure alert path failed");
    return "skipped";
  }
}

async function alertRecovery(opts: {
  check: HealthCheckResult;
  now: Date;
}): Promise<boolean> {
  const fingerprint = failFingerprint(opts.check.id);
  // Look back further than the quiet window so a resolved outage still notifies.
  const lookback = new Date(opts.now.getTime() - 24 * 60 * 60 * 1000);
  try {
    const existing = await db
      .select()
      .from(reliabilityEventsTable)
      .where(
        and(
          eq(reliabilityEventsTable.fingerprint, fingerprint),
          gt(reliabilityEventsTable.updatedAt, lookback),
        ),
      )
      .limit(1);

    const row = existing[0];
    if (!row) return false;
    // Only send recovery if we previously alerted (or at least recorded a fail).
    const previouslyAlerted = !!row.lastAlertedAt;
    // Mark the failure row as recovered by bumping updatedAt + rewriting stack.
    await db
      .update(reliabilityEventsTable)
      .set({
        updatedAt: opts.now,
        errorMessage: `health recovered: ${opts.check.id}`,
        errorStack: serializeCheck(opts.check, "ok"),
        // Clear lastAlertedAt so a future fail can alert immediately.
        lastAlertedAt: null,
      })
      .where(eq(reliabilityEventsTable.id, row.id));

    if (!previouslyAlerted) return false;

    const sent = await sendTelegramMessage(
      formatHealthRecoveryAlert({
        checkId: opts.check.id,
        detail: opts.check.detail,
        latencyMs: opts.check.latencyMs,
      }),
    );
    return sent.ok === true && sent.skipped !== true;
  } catch (err) {
    logger.warn({ err, check: opts.check.id }, "health recovery alert path failed");
    return false;
  }
}

/**
 * Run health checks, page Telegram on new/repeated (deduped) failures,
 * and notify once when a previously-alerted check recovers.
 */
export async function runReliabilityHealthMonitor(
  env: HealthCheckEnv = {},
  now = new Date(),
): Promise<HealthRunOutcome> {
  const checks = await runReliabilityHealthChecks(env);
  const summary = summarizeHealthChecks(checks);
  const alerted: HealthCheckId[] = [];
  const recovered: HealthCheckId[] = [];
  const deduped: HealthCheckId[] = [];

  for (const check of checks) {
    if (!check.ok) {
      const outcome = await alertFailure({ check, now });
      if (outcome === "alerted") alerted.push(check.id);
      if (outcome === "deduped") deduped.push(check.id);
    } else {
      const didRecover = await alertRecovery({ check, now });
      if (didRecover) recovered.push(check.id);
    }
  }

  return {
    ok: summary.ok,
    checks,
    failed: summary.failed,
    passed: summary.passed,
    alerted,
    recovered,
    deduped,
  };
}
