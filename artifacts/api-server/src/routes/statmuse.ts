import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports";
import { askStatMuse, askStatMuseGameLog } from "../lib/statmuse";

const router: IRouter = Router();

router.use("/sports/statmuse", rateLimit({ windowMs: 60_000, max: 40, name: "statmuse" }));
router.use("/sports/statmuse-gamelog", rateLimit({ windowMs: 60_000, max: 30, name: "statmuse-gamelog" }));

// GET /api/sports/statmuse?q=<question>&league=<sportId|statmuseSlug>
// Returns a single real natural-language stat answer from StatMuse, or
// { answer: null } when StatMuse has no confident answer.
router.get("/sports/statmuse", async (req, res): Promise<void> => {
  const q = String(req.query["q"] || "").trim();
  const league = String(req.query["league"] || "").trim() || null;
  if (!q) {
    res.status(400).json({ error: "Missing q" });
    return;
  }
  try {
    const result = await askStatMuse(q, league);
    res.json(result);
  } catch (err) {
    req.log?.error?.({ err }, "statmuse lookup failed");
    res.status(502).json({ error: "StatMuse lookup failed" });
  }
});

// GET /api/sports/statmuse-gamelog?q=<question>&league=<sportId|statmuseSlug>
// Returns a REAL game-by-game period breakdown (e.g. "first quarter points in
// the last 5 games") scraped from StatMuse's results grid, or { rows: [] } when
// StatMuse has no verified per-game table. Never fabricated.
router.get("/sports/statmuse-gamelog", async (req, res): Promise<void> => {
  const q = String(req.query["q"] || "").trim();
  const league = String(req.query["league"] || "").trim() || null;
  if (!q) {
    res.status(400).json({ error: "Missing q" });
    return;
  }
  try {
    const result = await askStatMuseGameLog(q, league);
    res.json(result || { rows: [] });
  } catch (err) {
    req.log?.error?.({ err }, "statmuse gamelog failed");
    res.status(502).json({ error: "StatMuse gamelog failed" });
  }
});

export default router;
