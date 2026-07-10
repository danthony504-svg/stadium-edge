import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import { buildFightAnalysis } from "../lib/ufc.js";

const router: IRouter = Router();

router.use("/sports/fight-analysis", rateLimit({ windowMs: 60_000, max: 120, name: "fight-analysis" }));

function parseH2hOutcomes(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; price: number; book?: string | null }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as { name?: string }).name ?? "").trim();
    const price = Number((item as { price?: number }).price);
    const book = (item as { book?: string }).book ?? null;
    if (!name || !Number.isFinite(price)) continue;
    out.push({ name, price, book });
  }
  return out;
}

async function respondFightAnalysis(
  away: string,
  home: string,
  h2hOutcomes: ReturnType<typeof parseH2hOutcomes>,
  res: import("express").Response,
) {
  if (!away || !home) {
    res.status(400).json({ error: "away and home fighter names are required" });
    return;
  }
  try {
    const analysis = await buildFightAnalysis(away, home, { h2hOutcomes });
    res.json(analysis);
  } catch {
    res.status(502).json({ error: "fight analysis unavailable" });
  }
}

router.get("/sports/fight-analysis", async (req, res) => {
  const away = String(req.query.away || "").trim();
  const home = String(req.query.home || "").trim();
  await respondFightAnalysis(away, home, [], res);
});

// POST accepts posted h2h outcomes (all books) to grade moneyline recommendations.
router.post("/sports/fight-analysis", async (req, res) => {
  const away = String(req.body?.away || "").trim();
  const home = String(req.body?.home || "").trim();
  const h2hOutcomes = parseH2hOutcomes(req.body?.h2hOutcomes);
  await respondFightAnalysis(away, home, h2hOutcomes, res);
});

export default router;
