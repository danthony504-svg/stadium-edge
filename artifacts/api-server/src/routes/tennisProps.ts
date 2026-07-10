import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { analyzeTennisMatchProps } from "../lib/tennisPropEngine.js";
import { tennisPropsFeatureEnabled } from "../lib/tennisPropVendor.js";
import type { TennisPropLearningRow } from "../lib/tennisPropLearning.js";

const router: IRouter = Router();

router.use("/sports/tennis-props", rateLimit({ windowMs: 60_000, max: 40, name: "tennis-props" }));

// GET /sports/tennis-props/status
router.get("/sports/tennis-props/status", (_req, res) => {
  res.json({
    enabled: tennisPropsFeatureEnabled(),
    requires: ["TENNIS_PROPS_ENABLED=1", "ODDS_API_KEY", "optional TENNIS_STATS_VENDOR_URL"],
  });
});

// GET /sports/tennis-props/analyze?away=&home=&eventId=
// Analyzes every posted prop for a match; returns only recommendations that pass gates.
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

  let learningHistory: TennisPropLearningRow[] | undefined;
  if (req.query.learning) {
    try {
      learningHistory = JSON.parse(String(req.query.learning)) as TennisPropLearningRow[];
    } catch {
      res.status(400).json({ error: "learning must be valid JSON array" });
      return;
    }
  }

  try {
    const result = await analyzeTennisMatchProps({
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
