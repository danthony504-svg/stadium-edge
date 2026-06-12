import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { buildTennisMatchup } from "../lib/tennis.js";

const router: IRouter = Router();

// Real tennis matchup: both players' ESPN ATP/WTA ranking + country + season
// recent form (set scores) + any recent head-to-head. ESPN hits are cached in
// buildTennisMatchup, but still cap per-IP since a cold call fans out to
// rankings + scoreboards + per-player eventlogs.
router.use("/sports/tennis-matchup", rateLimit({ windowMs: 60_000, max: 120, name: "tennis-matchup" }));

router.get("/sports/tennis-matchup", async (req, res) => {
  const away = String(req.query.away || "").trim();
  const home = String(req.query.home || "").trim();
  if (!away || !home) {
    res.status(400).json({ error: "away and home player names are required" });
    return;
  }
  try {
    const matchup = await buildTennisMatchup(away, home);
    res.json(matchup);
  } catch {
    res.status(502).json({ error: "tennis matchup unavailable" });
  }
});

export default router;
