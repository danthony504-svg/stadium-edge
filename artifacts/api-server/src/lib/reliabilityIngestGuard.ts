/**
 * Shared / fail-closed guards for anonymous crash ingest.
 *
 * See reliabilityPolicy.ts + docs/RELIABILITY_PHASE_A_OPS.md for the security model.
 */

import { gt, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, reliabilityEventsTable } from "@workspace/db";
import { rateLimitHit } from "./store.js";
import { logger } from "./logger.js";
import {
  RELIABILITY_HOURLY_OCCURRENCE_BUDGET,
  reliabilitySecurityModelSummary,
} from "./reliabilityPolicy.js";

export {
  RELIABILITY_HOURLY_OCCURRENCE_BUDGET,
  reliabilitySecurityModelSummary,
} from "./reliabilityPolicy.js";

export type IngestBudgetResult =
  | { ok: true; used: number; budget: number; redis: boolean }
  | { ok: false; used: number; budget: number; redis: boolean; reason: string };

/**
 * PostgreSQL-backed hourly budget. Fail closed when the DB is unavailable —
 * shed telemetry rather than accept unbounded writes.
 */
export async function checkReliabilityHourlyBudget(
  now = new Date(),
  budget = RELIABILITY_HOURLY_OCCURRENCE_BUDGET,
): Promise<IngestBudgetResult> {
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const redis = reliabilitySecurityModelSummary().redisConfigured;
  try {
    const rows = await db
      .select({
        used: sql<number>`coalesce(sum(${reliabilityEventsTable.occurrenceCount}), 0)`,
      })
      .from(reliabilityEventsTable)
      .where(gt(reliabilityEventsTable.updatedAt, since));
    const used = Number(rows[0]?.used ?? 0);
    if (!Number.isFinite(used) || used >= budget) {
      return {
        ok: false,
        used: Number.isFinite(used) ? used : budget,
        budget,
        redis,
        reason: "hourly_budget_exceeded",
      };
    }
    return { ok: true, used, budget, redis };
  } catch (err) {
    logger.warn({ err }, "reliability hourly budget check failed — shedding");
    return {
      ok: false,
      used: -1,
      budget,
      redis,
      reason: "budget_check_unavailable",
    };
  }
}

/**
 * Fail-closed IP rate limit for crash ingest (never fail-open).
 */
export function crashIngestRateLimit(opts: {
  windowMs: number;
  max: number;
  name: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
    const bucketKey = `${opts.name}:${identity}`;
    rateLimitHit(bucketKey, opts.windowMs, opts.max)
      .then((limited) => {
        if (limited) {
          res.status(429).json({ error: "Too many requests" });
          return;
        }
        next();
      })
      .catch((err) => {
        logger.warn({ err }, "crash ingest rate limit unavailable — shedding");
        res.status(503).json({ error: "rate limit unavailable" });
      });
  };
}
