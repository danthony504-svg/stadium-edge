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
    // Per-event extra markets: alternate ladders PLUS period markets
    // (game-level halves/quarters: h2h/spreads/totals for h1, h2, q1-q4,
    // plus alternate_spreads_h1 and alternate_totals_h1 — the "half lines"
    // and "half margin" ladders). The Odds API rejects per-player Q2/Q3/Q4/H2
    // for NBA, so player props for those periods are not available; the
    // game-level period markets ARE supported across all bookmakers.
    // NFL/NCAAF support is similar; the same key set is requested for all
    // sports — the API ignores unsupported keys per sport, no global reject
    // since these are all "valid" keys (only the per-player Q2+/H2 set is
    // invalid, and that's handled in props.ts).
    const PERIOD_GAME_MARKETS = [
      "alternate_spreads", "alternate_totals",
      "spreads_h1", "totals_h1", "h2h_h1",
      "spreads_h2", "totals_h2", "h2h_h2",
      "spreads_q1", "totals_q1", "h2h_q1",
      "spreads_q2", "totals_q2", "h2h_q2",
      "spreads_q3", "totals_q3", "h2h_q3",
      "spreads_q4", "totals_q4", "h2h_q4",
      "alternate_spreads_h1", "alternate_totals_h1",
    ];
    type Outcome = { name: string; price: number; point: number | null };
    const altByEvent = new Map<string, Map<string, Map<string, Outcome>>>();
    await Promise.all(
      upcoming.map(async (g) => {
        try {
          const evGame = await cachedJson(
            `odds:${oddsKey}:alt:${g.id}:v2`,
            10 * 60 * 1000,
            async () => {
              const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${g.id}/odds/?apiKey=${apiKey}&regions=us&markets=${PERIOD_GAME_MARKETS.join(",")}&oddsFormat=american`;
              const r = await fetch(url);
              if (!r.ok) return null;
              return (await r.json()) as RawOddsGame;
            },
          );
          if (!evGame) return;
          // Generic best-price-by-(name,point) merge across bookmakers for
          // every period market key the API returned. Lower-juice wins
          // (using americanToProb so favorites and dogs compare correctly).
          const byMarket = new Map<string, Map<string, Outcome>>();
          for (const b of evGame.bookmakers ?? []) {
            for (const m of b.markets ?? []) {
              if (!PERIOD_GAME_MARKETS.includes(m.key)) continue;
              let bucket = byMarket.get(m.key);
              if (!bucket) { bucket = new Map(); byMarket.set(m.key, bucket); }
              for (const o of m.outcomes ?? []) {
                const k = `${o.name}|${o.point ?? ""}`;
                const prev = bucket.get(k);
                if (!prev || americanToProb(o.price) < americanToProb(prev.price)) {
                  bucket.set(k, { name: o.name, price: Math.round(o.price), point: o.point ?? null });
                }
              }
            }
          }
          if (byMarket.size) altByEvent.set(g.id, byMarket);
        } catch {
          // Best-effort — failure just means no alt/period ladder for this game.
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
      if (alt) {
        // Emit each period/alt market in a stable order so downstream
        // consumers (and the chat AI) see them grouped predictably.
        for (const key of PERIOD_GAME_MARKETS) {
          const bucket = alt.get(key);
          if (bucket?.size) altMarkets.push({ key, outcomes: Array.from(bucket.values()) });
        }
      }
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
