import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { COACH_PARLAY_SIZES } from "@workspace/coach-types";
import { parseLegsQuery, parseSportQuery } from "@workspace/coach-runtime";
import { getCoachV2Runtime, isCoachV2Enabled } from "../lib/coachV2Runtime.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function v2Disabled(_req: Request, res: Response): void {
  res.status(404).json({ error: "coach v2 not enabled" });
}

function requireV2(req: Request, res: Response, next: NextFunction): void {
  if (!isCoachV2Enabled()) {
    v2Disabled(req, res);
    return;
  }
  next();
}

router.use("/coach/v2", requireV2);

/** Server-authoritative precomputed slate snapshot. */
router.get("/coach/v2/slate", async (_req, res): Promise<void> => {
  try {
    const runtime = getCoachV2Runtime();
    const payload = await runtime.getSlate();
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "coach v2 slate GET failed");
    res.status(500).json({ error: "failed to load coach v2 slate" });
  }
});

/** Precomputed ticket for a leg count and optional sport filter. */
router.get("/coach/v2/ticket", async (req, res): Promise<void> => {
  try {
    const legs = parseLegsQuery(req.query.legs) ?? 5;
    const sport = parseSportQuery(req.query.sport);
    const runtime = getCoachV2Runtime();
    const ticket = await runtime.getTicket({ legs, sport });
    if (!ticket) {
      res.status(404).json({ error: "ticket not available" });
      return;
    }
    res.json(ticket);
  } catch (err) {
    logger.error({ err }, "coach v2 ticket GET failed");
    res.status(500).json({ error: "failed to load coach v2 ticket" });
  }
});

/** Background scan job status. */
router.get("/coach/v2/scan/status", async (_req, res): Promise<void> => {
  try {
    const runtime = getCoachV2Runtime();
    res.json(await runtime.getScanStatus());
  } catch (err) {
    logger.error({ err }, "coach v2 scan status GET failed");
    res.status(500).json({ error: "failed to load coach v2 scan status" });
  }
});

/** Cron entry — scheduled deployment POSTs here every few minutes. */
router.post("/coach/v2/cron", async (req, res): Promise<void> => {
  const key = process.env.COACH_V2_CRON_KEY || process.env.COACH_SLATE_CRON_KEY || process.env.PREBUILD_CRON_KEY || process.env.NOTIFY_CRON_KEY;
  if (!key) {
    res.status(503).json({ error: "cron not configured" });
    return;
  }
  if (req.get("x-cron-key") !== key) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const runtime = getCoachV2Runtime();
    const result = await runtime.runCronTick();
    res.json({
      outcome: result.outcome,
      fingerprint: result.snapshot?.fingerprint ?? null,
      serveable: result.snapshot?.serveable ?? false,
      error: result.error ?? null,
      supportedLegCounts: [...COACH_PARLAY_SIZES],
    });
  } catch (err) {
    logger.error({ err }, "coach v2 cron failed");
    res.status(500).json({ error: "cron failed" });
  }
});

export default router;
