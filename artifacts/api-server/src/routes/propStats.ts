import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { buildUfcFightContext } from "../lib/propEngine/adapters/ufcMonteCarlo.js";
import { createTennisStatsVendor } from "../lib/tennisPropVendor.js";

const router: IRouter = Router();

router.use("/sports/prop-stats", rateLimit({ windowMs: 60_000, max: 90, name: "prop-stats" }));

// GET /sports/prop-stats/match?sport=&away=&home=
// Embedded stats provider — ESPN baseline + optional HTTP overlay (PROP_STATS_VENDOR_URL).
router.get("/sports/prop-stats/match", async (req, res): Promise<void> => {
  const sport = String(req.query.sport ?? "").trim().toLowerCase();
  const away = String(req.query.away ?? "").trim();
  const home = String(req.query.home ?? "").trim();

  if (!sport || !away || !home) {
    res.status(400).json({ error: "sport, away, and home query params required" });
    return;
  }

  try {
    if (sport === "tennis") {
      const vendor = createTennisStatsVendor();
      const ctx = await vendor.enrichMatchContext(away, home);
      if (!ctx) {
        res.status(404).json({ error: "tennis match stats unavailable" });
        return;
      }
      res.json(ctx);
      return;
    }

    if (sport === "ufc" || sport === "mma") {
      const ctx = await buildUfcFightContext(away, home);
      if (!ctx) {
        res.status(404).json({ error: "UFC fight stats unavailable" });
        return;
      }
      res.json(ctx);
      return;
    }

    res.status(400).json({ error: `prop-stats not supported for sport: ${sport}` });
  } catch (err) {
    req.log?.error?.({ err }, "prop-stats match failed");
    res.status(502).json({
      error: err instanceof Error ? err.message : "prop stats unavailable",
    });
  }
});

export default router;
