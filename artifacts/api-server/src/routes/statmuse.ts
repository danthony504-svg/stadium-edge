import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports";
import { askStatMuse } from "../lib/statmuse";

const router: IRouter = Router();

router.use("/sports/statmuse", rateLimit({ windowMs: 60_000, max: 40 }));

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

export default router;
