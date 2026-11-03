import { parseCoachCandidateChunk } from "../lib/coachCandidateTracking.js";
import { coachBuildBreakdown } from "../lib/coachBuildBreakdown.js";
/**
 * Reliability Center — crash ingest, Coach events, daily digest, 90m health.
 * No owner dashboard in this phase. No secrets required from the mobile client.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  CRASH_MAX_BODY_BYTES,
  parseAndSanitizeCrashBody,
} from "../lib/reliabilitySanitize";
import {
  COACH_EVENT_MAX_BODY_BYTES,
  isCoachReliabilityTestFixture,
  parseCoachReliabilityIngestBody,
} from "../lib/coachReliabilityIngest";
import {
  coachReliabilityDigestStats,
  recordCoachReliabilityEvent,
} from "../lib/coachReliabilityStore";
import {
  ingestSanitizedCrash,
  pruneReliabilityEvents,
  reliabilityDigestStats,
} from "../lib/reliabilityCrashStore";
import {
  runReliabilityHealthChecks,
  summarizeHealthChecks,
} from "../lib/reliabilityHealthChecks";
import {
  runReliabilityHealthMonitor,
  runReliabilityTelegramProbe,
  type TelegramProbePhase,
} from "../lib/reliabilityHealthStore";
import {
  checkReliabilityHourlyBudget,
  crashIngestRateLimit,
} from "../lib/reliabilityIngestGuard";
import { reliabilitySecurityModelSummary } from "../lib/reliabilityPolicy";
import {
  formatDailyHealthySummary,
  sendTelegramMessage,
} from "../lib/telegramAlert";
import type { HealthCheckId } from "../lib/reliabilityHealthChecks";
import { authorizeCronRequest } from "../lib/cronAuth";

const router: IRouter = Router();

const crashLimiter = crashIngestRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  name: "reliability-crashes",
});

const crashHourlyLimiter = crashIngestRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  name: "reliability-crashes-hour",
});

const coachEventLimiter = crashIngestRateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  name: "reliability-coach-events",
});

function rawBodyTooLarge(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(len) && len > maxBytes) return true;
  try {
    const encoded = JSON.stringify(req.body ?? {});
    return Buffer.byteLength(encoded, "utf8") > maxBytes;
  } catch {
    return true;
  }
}

/**
 * POST /api/reliability/crashes
 * Accepts sanitized crash envelopes from the mobile JS reporter.
 * Always responds quickly; never blocks product traffic on Telegram/DB issues.
 */
router.post(
  "/reliability/crashes",
  crashLimiter,
  crashHourlyLimiter,
  async (req: Request, res: Response) => {
    if (rawBodyTooLarge(req, CRASH_MAX_BODY_BYTES)) {
      res.status(413).json({ error: "payload too large" });
      return;
    }
    const event = parseAndSanitizeCrashBody(req.body);
    if (!event) {
      res.status(400).json({ error: "invalid crash payload" });
      return;
    }

    const budget = await checkReliabilityHourlyBudget();
    if (!budget.ok) {
      res.status(429).json({
        error: "ingest shed",
        reason: budget.reason,
        model: reliabilitySecurityModelSummary(),
      });
      return;
    }

    try {
      const outcome = await ingestSanitizedCrash(event);
      if (outcome.shed) {
        res.status(202).json({
          ok: true,
          accepted: false,
          deduped: false,
          shed: true,
        });
        return;
      }
      res.status(202).json({
        ok: true,
        accepted: outcome.accepted,
        deduped: outcome.deduped,
      });
    } catch (err) {
      logger.warn({ err }, "reliability crash route failed");
      // Fail soft — client must not retry-storm.
      res.status(202).json({ ok: true, accepted: false });
    }
  },
);

/**
 * POST /api/reliability/coach-events
 * Observe-only Coach integrity / fulfillment events from mobile scan path.
 * Never blocks Coach; fixtures are accepted but never Telegram-alerted.
 */
router.post(
  "/reliability/coach-events",
  coachEventLimiter,
  async (req: Request, res: Response) => {
    if (rawBodyTooLarge(req, COACH_EVENT_MAX_BODY_BYTES)) {
      res.status(413).json({ error: "payload too large" });
      return;
    }
    if (isCoachReliabilityTestFixture(req.body)) {
      res.status(202).json({
        ok: true,
        accepted: false,
        fixture: true,
        alerted: false,
      });
      return;
    }
    const event = parseCoachReliabilityIngestBody(req.body);
    if (!event) {
      res.status(400).json({ error: "invalid coach reliability payload" });
      return;
    }
    try {
      // Fire-and-forget style response: await store but never throw to client.
      // Store logs [coach-rel-diag] with correlationId / Telegram / dedupe.
      const outcome = await recordCoachReliabilityEvent(event);
      logger.info(
        {
          correlationId: event.correlationId ?? null,
          requestId: event.requestId ?? null,
          eventType: event.eventType,
          buildBreakdown: coachBuildBreakdown({ ...event }),
          failureReason: event.failureReason ?? null,
          failureCategory: event.failureCategory ?? null,
          affectedGame: event.affectedGame ?? null,
          accepted: outcome.accepted,
          alerted: outcome.alerted,
          deduped: outcome.deduped,
        },
        "[coach-rel-diag] coach-events route",
      );
      res.status(202).json({
        ok: true,
        accepted: outcome.accepted,
        deduped: outcome.deduped,
        alerted: outcome.alerted,
      });
    } catch (err) {
      logger.warn({ err }, "reliability coach-events route failed");
      res.status(202).json({ ok: true, accepted: false });
    }
  },
);

/** Bounded per-candidate diagnostics. Logs only; never triggers Telegram/push. */
const candidateTrackingLimiter = crashIngestRateLimit({
  windowMs: 10 * 60 * 1000, max: 120, name: "reliability-coach-candidates",
});
router.post("/reliability/coach-candidates", candidateTrackingLimiter, (req, res) => {
  if (rawBodyTooLarge(req, 100_000)) {
    res.status(413).json({ error: "payload too large" }); return;
  }
  const chunk = parseCoachCandidateChunk(req.body);
  if (!chunk) { res.status(400).json({ error: "invalid candidate diagnostics" }); return; }
  logger.info({ candidateTracking: chunk }, "[coach-candidates] build breakdown chunk");
  res.status(202).json({ accepted: true, requestId: chunk.requestId, chunkIndex: chunk.chunkIndex });
});

/**
 * POST /api/reliability/cron/digest
 * Daily healthy (or summary) Telegram + retention prune.
 * Guarded by NOTIFY_CRON_KEY (same as notifications cron).
 * Prune always runs even when Telegram is disabled / skipped.
 */
router.post("/reliability/cron/digest", async (req, res) => {
  const started = Date.now();
  if (!authorizeCronRequest(req, res)) return;
  try {
    // Prune first — retention must run even if Telegram is off.
    const pruned = await pruneReliabilityEvents();
    const stats = await reliabilityDigestStats(24);
    const coach = await coachReliabilityDigestStats(24);
    // Snapshot only — individual fail/recovery pages come from the 90m monitor.
    let healthOk: boolean | null = null;
    let healthFailed: string[] | null = null;
    try {
      const checks = await runReliabilityHealthChecks({});
      const summary = summarizeHealthChecks(checks);
      healthOk = summary.ok;
      healthFailed = summary.failed;
    } catch {
      healthOk = null;
      healthFailed = null;
    }

    const text = formatDailyHealthySummary({
      ...stats,
      coach,
      healthOk,
      healthFailed,
    });
    const sent = await sendTelegramMessage(text);
    res.json({
      ok: true,
      pruned,
      stats,
      coach,
      healthOk,
      healthFailed,
      telegram: sent,
      durationMs: Date.now() - started,
      model: reliabilitySecurityModelSummary(),
    });
  } catch (err) {
    logger.error({ err }, "reliability digest cron failed");
    res.status(500).json({ error: "digest failed" });
  }
});

/**
 * POST /api/reliability/cron/health
 * 90-minute health monitor — Telegram only on failure / recovery.
 */
router.post("/reliability/cron/health", async (req, res) => {
  const started = Date.now();
  if (!authorizeCronRequest(req, res)) return;
  try {
    const synthetic =
      req.body &&
      typeof req.body === "object" &&
      (req.body as { syntheticFail?: unknown }).syntheticFail;
    const forceFail =
      synthetic && typeof synthetic === "object"
        ? (synthetic as Record<string, string>)
        : undefined;

    const outcome = await runReliabilityHealthMonitor({
      forceFail: forceFail as Partial<Record<HealthCheckId, string>> | undefined,
    });
    res.json({
      ok: true,
      healthy: outcome.ok,
      failed: outcome.failed,
      passed: outcome.passed,
      alerted: outcome.alerted,
      recovered: outcome.recovered,
      deduped: outcome.deduped,
      checks: outcome.checks,
      durationMs: Date.now() - started,
      model: reliabilitySecurityModelSummary(),
    });
  } catch (err) {
    logger.error({ err }, "reliability health cron failed");
    res.status(500).json({ error: "health cron failed" });
  }
});

/**
 * POST /api/reliability/cron/telegram-probe
 * Production-safe Telegram proof: fail → 30m dedupe → recovery for
 * check id `telegram_probe` only. Does not fail real health checks.
 * Guarded by NOTIFY_CRON_KEY. Prefer this over health `syntheticFail`.
 */
router.post("/reliability/cron/telegram-probe", async (req, res) => {
  const started = Date.now();
  if (!authorizeCronRequest(req, res)) return;
  try {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as { phases?: unknown; phase?: unknown })
        : {};
    let phases: TelegramProbePhase[] | undefined;
    if (typeof body.phase === "string") {
      const p = body.phase.trim().toLowerCase();
      if (p === "fail" || p === "dedupe" || p === "recover") {
        phases = [p];
      }
    } else if (Array.isArray(body.phases)) {
      const parsed = body.phases
        .map((p) => String(p).trim().toLowerCase())
        .filter(
          (p): p is TelegramProbePhase =>
            p === "fail" || p === "dedupe" || p === "recover",
        );
      if (parsed.length > 0) phases = parsed;
    }

    const outcome = await runReliabilityTelegramProbe({ phases });
    res.json({
      ok: true,
      probe: outcome,
      durationMs: Date.now() - started,
      model: reliabilitySecurityModelSummary(),
    });
  } catch (err) {
    logger.error({ err }, "reliability telegram probe failed");
    res.status(500).json({ error: "telegram probe failed" });
  }
});

export default router;
