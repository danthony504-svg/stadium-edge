/**
 * Phase A reliability ingest — public crash POST (rate-limited), cron digest.
 * No owner dashboard in this phase. No secrets required from the mobile client.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  CRASH_MAX_BODY_BYTES,
  parseAndSanitizeCrashBody,
} from "../lib/reliabilitySanitize";
import {
  ingestSanitizedCrash,
  pruneReliabilityEvents,
  reliabilityDigestStats,
} from "../lib/reliabilityCrashStore";
import {
  checkReliabilityHourlyBudget,
  crashIngestRateLimit,
} from "../lib/reliabilityIngestGuard";
import { reliabilitySecurityModelSummary } from "../lib/reliabilityPolicy";
import {
  formatDailyHealthySummary,
  sendTelegramMessage,
} from "../lib/telegramAlert";

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

function rawBodyTooLarge(req: Request): boolean {
  const len = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(len) && len > CRASH_MAX_BODY_BYTES) return true;
  try {
    const encoded = JSON.stringify(req.body ?? {});
    return Buffer.byteLength(encoded, "utf8") > CRASH_MAX_BODY_BYTES;
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
    if (rawBodyTooLarge(req)) {
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
 * POST /api/reliability/cron/digest
 * Daily healthy (or summary) Telegram + retention prune.
 * Guarded by NOTIFY_CRON_KEY (same as notifications cron).
 * Prune always runs even when Telegram is disabled / skipped.
 */
router.post("/reliability/cron/digest", async (req, res) => {
  const started = Date.now();
  const key = process.env.NOTIFY_CRON_KEY;
  if (!key) {
    res.status(503).json({ error: "cron not configured" });
    return;
  }
  if (req.get("x-cron-key") !== key) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    // Prune first — retention must run even if Telegram is off.
    const pruned = await pruneReliabilityEvents();
    const stats = await reliabilityDigestStats(24);
    const text = formatDailyHealthySummary(stats);
    const sent = await sendTelegramMessage(text);
    res.json({
      ok: true,
      pruned,
      stats,
      telegram: sent,
      durationMs: Date.now() - started,
      model: reliabilitySecurityModelSummary(),
    });
  } catch (err) {
    logger.error({ err }, "reliability digest cron failed");
    res.status(500).json({ error: "digest failed" });
  }
});

export default router;
