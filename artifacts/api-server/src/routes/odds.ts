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
      `odds:${oddsKey}:v2-alt`,
      5 * 60 * 1000,
      async () => {
        const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals,alternate_spreads,alternate_totals&oddsFormat=american`;
        const r = await fetch(url);
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
        }
        return (await r.json()) as RawOddsGame[];
      },
    );

    // For main markets (h2h/spreads/totals) use the first bookmaker for
    // a single consistent price the user sees in the UI. For alternate
    // spreads/totals, aggregate across ALL bookmakers and keep the best
    // price per (name, point) so the user sees the widest possible ladder.
    const out = games.map((g) => {
      const book = g.bookmakers?.[0];
      const mainMarkets = (book?.markets ?? [])
        .filter((m) => ["h2h", "spreads", "totals"].includes(m.key))
        .map((m) => ({
          key: m.key,
          outcomes: (m.outcomes ?? []).map((o) => ({
            name: o.name,
            price: Math.round(o.price),
            point: o.point ?? null,
          })),
        }));
      const altAgg: Record<string, Map<string, { name: string; price: number; point: number | null }>> = {
        alternate_spreads: new Map(),
        alternate_totals: new Map(),
      };
      for (const b of g.bookmakers ?? []) {
        for (const m of b.markets ?? []) {
          if (!altAgg[m.key]) continue;
          for (const o of m.outcomes ?? []) {
            const k = `${o.name}|${o.point ?? ""}`;
            const prev = altAgg[m.key].get(k);
            const americanToProb = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
            if (!prev || americanToProb(o.price) < americanToProb(prev.price)) {
              altAgg[m.key].set(k, {
                name: o.name,
                price: Math.round(o.price),
                point: o.point ?? null,
              });
            }
          }
        }
      }
      const altMarkets = Object.entries(altAgg)
        .filter(([, m]) => m.size > 0)
        .map(([key, m]) => ({ key, outcomes: Array.from(m.values()) }));
      return {
        id: g.id,
        sport: sportId,
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        commenceTime: g.commence_time,
        markets: [...mainMarkets, ...altMarkets],
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
