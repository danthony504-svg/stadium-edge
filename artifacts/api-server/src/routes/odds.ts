import { Router, type IRouter } from "express";
import { GetOddsQueryParams, GetOddsResponse } from "@workspace/api-zod";
import { ODDS_SPORT_KEYS, cachedJson, rateLimit } from "../lib/sports";

const router: IRouter = Router();

// Paid Odds API — cap at 60 req/min/IP (cache absorbs most).
router.use("/sports/odds", rateLimit({ windowMs: 60_000, max: 60 }));

type RawOddsGame = {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: Array<{
    markets?: Array<{
      key: string;
      outcomes?: Array<{ name: string; price: number; point?: number }>;
    }>;
  }>;
};

router.get("/sports/odds", async (req, res): Promise<void> => {
  const parsed = GetOddsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sportId = parsed.data.sport.toLowerCase();
  const oddsKey = ODDS_SPORT_KEYS[sportId];
  if (!oddsKey) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "ODDS_API_KEY not configured" });
    return;
  }

  try {
    const games = await cachedJson(
      `odds:${oddsKey}`,
      5 * 60 * 1000,
      async () => {
        const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
        const r = await fetch(url);
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
        }
        return (await r.json()) as RawOddsGame[];
      },
    );

    const out = games.map((g) => {
      const book = g.bookmakers?.[0];
      const markets = (book?.markets ?? []).map((m) => ({
        key: m.key,
        outcomes: (m.outcomes ?? []).map((o) => ({
          name: o.name,
          price: Math.round(o.price),
          point: o.point ?? null,
        })),
      }));
      return {
        id: g.id,
        sport: sportId,
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        commenceTime: g.commence_time,
        markets,
      };
    });

    res.json(GetOddsResponse.parse(out));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch odds");
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Upstream error" });
  }
});

export default router;
