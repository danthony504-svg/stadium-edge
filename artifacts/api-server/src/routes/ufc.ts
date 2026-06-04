import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { buildFightAnalysis } from "../lib/ufc.js";

const router: IRouter = Router();

// Real UFC fight breakdown: both fighters' ESPN records + career striking/
// grappling rates + a deterministic "stronger fighter & why" lean. ESPN hits
// are cached in buildFightAnalysis, but still cap per-IP since each call can
// fan out to a search + records + statistics per fighter.
router.use("/sports/fight-analysis", rateLimit({ windowMs: 60_000, max: 120, name: "fight-analysis" }));

router.get("/sports/fight-analysis", async (req, res) => {
  const away = String(req.query.away || "").trim();
  const home = String(req.query.home || "").trim();
  if (!away || !home) {
    res.status(400).json({ error: "away and home fighter names are required" });
    return;
  }
  try {
    const analysis = await buildFightAnalysis(away, home);
    res.json(analysis);
  } catch (err) {
    res.status(502).json({ error: "fight analysis unavailable" });
  }
});

export default router;
