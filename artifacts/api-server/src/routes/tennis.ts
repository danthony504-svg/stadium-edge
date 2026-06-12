import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { buildTennisMatchup, buildTennisPlayer } from "../lib/tennis.js";

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

// Real single-player stats sheet: ESPN ATP/WTA ranking + bio + career singles
// record + season recent form. Cold calls fan out to rankings + scoreboards +
// the athlete bio/statistics/eventlog, so cap per-IP like the matchup route.
router.use("/sports/tennis-player", rateLimit({ windowMs: 60_000, max: 120, name: "tennis-player" }));

router.get("/sports/tennis-player", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "player name is required" });
    return;
  }
  try {
    const profile = await buildTennisPlayer(name);
    res.json(profile);
  } catch {
    res.status(502).json({ error: "tennis player unavailable" });
  }
});

export default router;
