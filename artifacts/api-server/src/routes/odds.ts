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
    // The Odds API only supports h2h/spreads/totals on the bulk /odds
    // endpoint. alternate_spreads and alternate_totals are per-event:
    // /sports/{sport}/events/{eventId}/odds. So we fetch mains in bulk,
    // then fan out to the per-event endpoint for alts, cached separately
    // with a longer TTL to keep credit usage sane.
    const games = await cachedJson(
      `odds:${oddsKey}:v3`,
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

    // Fan out alt fetches in parallel for each event that hasn't kicked
    // off yet and starts within the next 48h. Cap concurrency by
    // limiting how many games we even try per request. Per-event cache
    // is 10 min — alt markets are 5x credit cost so we don't want to
    // re-hit them on every poll.
    const americanToProb = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
    const now = Date.now();
    const WINDOW_MS = 48 * 60 * 60 * 1000;
    const upcoming = games.filter((g) => {
      const t = new Date(g.commence_time).getTime();
      return !isNaN(t) && t > now - 30 * 60 * 1000 && t < now + WINDOW_MS;
    }).slice(0, 12); // cap credit spend
    const altByEvent = new Map<string, { spreads: Map<string, { name: string; price: number; point: number | null }>; totals: Map<string, { name: string; price: number; point: number | null }> }>();
    await Promise.all(
      upcoming.map(async (g) => {
        try {
          const evGame = await cachedJson(
            `odds:${oddsKey}:alt:${g.id}:v1`,
            10 * 60 * 1000,
            async () => {
              const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${g.id}/odds/?apiKey=${apiKey}&regions=us&markets=alternate_spreads,alternate_totals&oddsFormat=american`;
              const r = await fetch(url);
              if (!r.ok) return null;
              return (await r.json()) as RawOddsGame;
            },
          );
          if (!evGame) return;
          const spreads = new Map<string, { name: string; price: number; point: number | null }>();
          const totals = new Map<string, { name: string; price: number; point: number | null }>();
          for (const b of evGame.bookmakers ?? []) {
            for (const m of b.markets ?? []) {
              const bucket = m.key === "alternate_spreads" ? spreads : m.key === "alternate_totals" ? totals : null;
              if (!bucket) continue;
              for (const o of m.outcomes ?? []) {
                const k = `${o.name}|${o.point ?? ""}`;
                const prev = bucket.get(k);
                if (!prev || americanToProb(o.price) < americanToProb(prev.price)) {
                  bucket.set(k, { name: o.name, price: Math.round(o.price), point: o.point ?? null });
                }
              }
            }
          }
          if (spreads.size || totals.size) altByEvent.set(g.id, { spreads, totals });
        } catch {
          // Best-effort — alt fetch failure just means no alt ladder for this game.
        }
      }),
    );

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
      const alt = altByEvent.get(g.id);
      const altMarkets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point: number | null }> }> = [];
      if (alt?.spreads.size) altMarkets.push({ key: "alternate_spreads", outcomes: Array.from(alt.spreads.values()) });
      if (alt?.totals.size) altMarkets.push({ key: "alternate_totals", outcomes: Array.from(alt.totals.values()) });
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
