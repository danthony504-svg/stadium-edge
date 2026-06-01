import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports";
import { getBBRefSeason } from "../lib/bballref";

const router: IRouter = Router();

router.use("/sports/bballref", rateLimit({ windowMs: 60_000, max: 30 }));

// GET /api/sports/bballref?name=<player>
// Returns the player's most recent REAL NBA season per-game averages parsed
// from Basketball-Reference, or { result: null } when no player/table matched.
router.get("/sports/bballref", async (req, res): Promise<void> => {
  const name = String(req.query["name"] || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing name" });
    return;
  }
  try {
    const result = await getBBRefSeason(name);
    res.json({ result });
  } catch (err) {
    req.log?.error?.({ err }, "bballref lookup failed");
    res.status(502).json({ error: "Basketball-Reference lookup failed" });
  }
});

export default router;
