import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { analyzeEventProps, analyzeEventPropsBatch, propEngineEnabled } from "../lib/propEngine/analyze.js";
import { registeredPropEngineSports } from "../lib/propEngine/registry.js";
import type { PropLearningRow } from "../lib/propEngine/types.js";

const router: IRouter = Router();

router.use("/sports/prop-engine", rateLimit({ windowMs: 60_000, max: 60, name: "prop-engine" }));

router.get("/sports/prop-engine/status", (_req, res) => {
  res.json({
    enabled: propEngineEnabled(),
    sports: registeredPropEngineSports(),
    requires: [
      "PROP_ENGINE_ENABLED=1",
      "ODDS_API_KEY",
      "optional PROP_ODDS_VENDOR_URL (combat/tennis prop overlay)",
      "optional PROP_STATS_VENDOR_URL (serve/return depth)",
      "optional TENNIS_STATS_VENDOR_URL (tennis-specific stats)",
    ],
    endpoints: [
      "GET /sports/prop-engine/analyze",
      "POST /sports/prop-engine/analyze-batch",
      "GET /sports/prop-stats/match",
    ],
  });
});

// GET /sports/prop-engine/analyze?sport=&away=&home=&eventId=
router.get("/sports/prop-engine/analyze", async (req, res): Promise<void> => {
  const sport = String(req.query.sport ?? "").trim().toLowerCase();
  const away = String(req.query.away ?? "").trim();
  const home = String(req.query.home ?? "").trim();
  const eventId = String(req.query.eventId ?? "").trim() || undefined;
  const simulations = req.query.simulations
    ? parseInt(String(req.query.simulations), 10)
    : undefined;

  if (!sport || !away || !home) {
    res.status(400).json({ error: "sport, away, and home query params required" });
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
      sport,
      away,
      home,
      eventId,
      simulations: Number.isFinite(simulations) ? simulations : undefined,
      learningHistory,
    });
    res.json(result);
  } catch (err) {
    req.log?.error?.({ err }, "prop-engine analyze failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "prop analysis failed",
    });
  }
});

// POST /sports/prop-engine/analyze-batch
// Body: { events: [{ sport, away, home, eventId? }], learningHistory?, maxRecommendations? }
router.post("/sports/prop-engine/analyze-batch", async (req, res): Promise<void> => {
  const body = req.body as {
    events?: Array<{ sport?: string; away?: string; home?: string; eventId?: string }>;
    learningHistory?: PropLearningRow[];
    maxRecommendations?: number;
    simulations?: number;
  };

  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) {
    res.status(400).json({ error: "events array required" });
    return;
  }

  const normalized = events
    .map((e) => ({
      sport: String(e.sport ?? "").trim().toLowerCase(),
      away: String(e.away ?? "").trim(),
      home: String(e.home ?? "").trim(),
      eventId: e.eventId ? String(e.eventId).trim() : undefined,
    }))
    .filter((e) => e.sport && e.away && e.home);

  if (normalized.length === 0) {
    res.status(400).json({ error: "each event needs sport, away, and home" });
    return;
  }

  try {
    const results = await analyzeEventPropsBatch({
      events: normalized,
      learningHistory: body.learningHistory,
      maxRecommendations: body.maxRecommendations,
      simulations: body.simulations,
    });
    res.json({ results });
  } catch (err) {
    req.log?.error?.({ err }, "prop-engine analyze-batch failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "prop batch analysis failed",
    });
  }
});

export default router;
