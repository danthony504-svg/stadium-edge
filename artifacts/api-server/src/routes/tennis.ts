import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports.js";
import {
  buildTennisMatchup,
  buildTennisPlayer,
  buildTennisAnalysis,
  loadTennisFlags,
  type H2hPostedOutcome,
  type SpreadPostedOutcome,
  type TotalPostedOutcome,
} from "../lib/tennis.js";

const router: IRouter = Router();

function parseH2hOutcomes(raw: unknown): H2hPostedOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: H2hPostedOutcome[] = [];
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

function parseSpreadOutcomes(raw: unknown): SpreadPostedOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: SpreadPostedOutcome[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as { name?: string }).name ?? "").trim();
    const price = Number((item as { price?: number }).price);
    const point = Number((item as { point?: number }).point);
    const book = (item as { book?: string }).book ?? null;
    if (!name || !Number.isFinite(price) || !Number.isFinite(point)) continue;
    out.push({ name, price, point, book });
  }
  return out;
}

function parseTotalOutcomes(raw: unknown): TotalPostedOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: TotalPostedOutcome[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as { name?: string }).name ?? "").trim();
    const price = Number((item as { price?: number }).price);
    const point = Number((item as { point?: number }).point);
    const book = (item as { book?: string }).book ?? null;
    if (!name || !Number.isFinite(price) || !Number.isFinite(point)) continue;
    out.push({ name, price, point, book });
  }
  return out;
}

// Real ESPN country flags for every player in an active ATP/WTA draw, keyed by
// a normalized player name. Tennis players have no club crest, so the Upcoming
// cards render the country flag instead of plain initials. One cached fetch
// serves the whole slate. Real data only — a missing player has no entry and
// the client falls back to initials.
router.use("/sports/tennis-flags", rateLimit({ windowMs: 60_000, max: 120, name: "tennis-flags" }));

router.get("/sports/tennis-flags", async (_req, res) => {
  try {
    const flags = await loadTennisFlags();
    res.json(flags);
  } catch {
    res.json({});
  }
});

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

async function respondTennisAnalysis(
  away: string,
  home: string,
  h2hOutcomes: H2hPostedOutcome[],
  spreadOutcomes: SpreadPostedOutcome[],
  totalOutcomes: TotalPostedOutcome[],
  res: import("express").Response,
) {
  if (!away || !home) {
    res.status(400).json({ error: "away and home player names are required" });
    return;
  }
  try {
    const analysis = await buildTennisAnalysis(away, home, {
      h2hOutcomes,
      spreadOutcomes,
      totalOutcomes,
    });
    res.json(analysis);
  } catch {
    res.status(502).json({ error: "tennis analysis unavailable" });
  }
}

// Real tennis analysis: matchup + lean + pre-pick checklist + 10k sim + graded picks.
router.use("/sports/tennis-analysis", rateLimit({ windowMs: 60_000, max: 120, name: "tennis-analysis" }));

router.get("/sports/tennis-analysis", async (req, res) => {
  const away = String(req.query.away || "").trim();
  const home = String(req.query.home || "").trim();
  await respondTennisAnalysis(away, home, [], [], [], res);
});

// POST accepts posted h2h / spread / total outcomes to grade recommendations.
router.post("/sports/tennis-analysis", async (req, res) => {
  const away = String(req.body?.away || "").trim();
  const home = String(req.body?.home || "").trim();
  const h2hOutcomes = parseH2hOutcomes(req.body?.h2hOutcomes);
  const spreadOutcomes = parseSpreadOutcomes(req.body?.spreadOutcomes);
  const totalOutcomes = parseTotalOutcomes(req.body?.totalOutcomes);
  await respondTennisAnalysis(away, home, h2hOutcomes, spreadOutcomes, totalOutcomes, res);
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
