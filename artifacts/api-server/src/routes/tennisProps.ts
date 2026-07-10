import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { analyzeEventProps } from "../lib/propEngine/analyze.js";
import { propEngineEnabled } from "../lib/propEngine/analyze.js";
import type { PropLearningRow } from "../lib/propEngine/types.js";

const router: IRouter = Router();

router.use("/sports/tennis-props", rateLimit({ windowMs: 60_000, max: 40, name: "tennis-props" }));

router.get("/sports/tennis-props/status", (_req, res) => {
  res.json({
    enabled: propEngineEnabled(),
    requires: ["PROP_ENGINE_ENABLED=1", "ODDS_API_KEY", "optional PROP_STATS_VENDOR_URL"],
  });
});

router.get("/sports/tennis-props/analyze", async (req, res): Promise<void> => {
  const away = String(req.query.away ?? "").trim();
  const home = String(req.query.home ?? "").trim();
  const eventId = String(req.query.eventId ?? "").trim() || undefined;
  const simulations = req.query.simulations
    ? parseInt(String(req.query.simulations), 10)
    : undefined;

  if (!away || !home) {
    res.status(400).json({ error: "away and home query params required" });
    return;
  }

  let learningHistory: PropLearningRow[] | undefined;
  if (req.query.learning) {
    try {
      learningHistory = JSON.parse(String(req.query.learning)) as PropLearningRow[];
    } catch {
      res.status(400).json({ error: "learning must be valid JSON array" });
      return;
    }
  }

  try {
    const result = await analyzeEventProps({
      sport: "tennis",
      away,
      home,
      eventId,
      simulations: Number.isFinite(simulations) ? simulations : undefined,
      learningHistory,
    });
    res.json(result);
  } catch (err) {
    req.log?.error?.({ err }, "tennis-props analyze failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "tennis prop analysis failed",
    });
  }
});

export default router;
