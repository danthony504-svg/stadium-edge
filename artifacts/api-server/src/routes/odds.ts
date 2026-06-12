import { Router, type IRouter } from "express";
import { GetOddsQueryParams, GetOddsResponse } from "@workspace/api-zod";
import { ODDS_SPORT_KEYS, resolveOddsKeys, cachedJson, rateLimit } from "../lib/sports";
import { resolveWorldCupTeam } from "./props";

const router: IRouter = Router();

// Paid Odds API — cap at 60 req/min/IP (cache absorbs most).
router.use("/sports/odds", rateLimit({ windowMs: 60_000, max: 60, name: "odds" }));

type RawOddsGame = {
  id: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
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
  if (ODDS_SPORT_KEYS[sportId] === undefined) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  // Some app sports fan out to MULTIPLE Odds API keys (soccer = several
  // leagues, tennis = the active ATP + WTA tournaments) which are fetched and
  // merged. Tennis keys are resolved dynamically from the live Odds API calendar
  // (the per-tournament keys change week to week); everything else is static.
  const oddsKeys = await resolveOddsKeys(sportId);
  // Table Tennis is winner-odds (moneyline) ONLY — it has no Odds API keys and
  // comes from the Bovada fallback, which lists only the match moneyline.
  // Tennis carries the match winner (h2h), game spread (handicap), and Total
  // Match Games (totals) — all REAL from the Odds API bulk feed — but it has no
  // halves/quarters, so it skips the per-event alt/period fetch (skipAltPeriod)
  // and serves mains only. We never request set betting / set winners: the Odds
  // API doesn't carry them (INVALID_MARKET), so they'd have to be fabricated.
  const moneylineOnly = sportId === "tabletennis";
  const skipAltPeriod = moneylineOnly || sportId === "tennis";
  const bulkMarkets = moneylineOnly ? "h2h" : "h2h,spreads,totals";
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
    // Fetch each underlying Odds API key (cached per key) and merge. Each key
    // is best-effort: one dead/empty league (common late-season) must not wipe
    // out the others, so a per-key failure resolves to [] rather than throwing.
    const perKey = await Promise.all(
      oddsKeys.map((key) =>
        cachedJson(
          `odds:${key}:v3`,
          5 * 60 * 1000,
          async () => {
            // Scan us + us2 so we cover MORE sportsbooks (Fanatics, ESPN BET,
            // Hard Rock, Fliff, etc.). More books = more cross-book price gaps =
            // more real arbitrage/value found, and a better chance of catching a
            // higher-% edge when one genuinely exists. (Real arbs stay small —
            // this widens the net, it does not inflate the number.)
            const url = `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${apiKey}&regions=us,us2&markets=${bulkMarkets}&oddsFormat=american`;
            const r = await fetch(url);
            if (!r.ok) {
              const text = await r.text();
              throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
            }
            return (await r.json()) as RawOddsGame[];
          },
        ).catch(() => [] as RawOddsGame[]),
      ),
    );
    let games = perKey.flat();

    // ── Finished World Cup game suppression ──────────────────────────────
    // The Odds API keeps a match in its feed during play and for a while
    // AFTER the final whistle — the line just freezes at lopsided in-play
    // numbers (e.g. -2500 / +250000), so a game that has clearly ended still
    // looks bettable. WC national-team games are NOT in ESPN's club soccer
    // feed, so the generic in-progress window can't tell a finished match
    // from a live one. Use ESPN's FIFA World Cup scoreboard — the
    // authoritative status source — to drop matches it marks completed.
    // Real status only; on any scoreboard error we keep the games as-is
    // (fail-open — never hide a genuinely live match on a transient hiccup).
    if (sportId === "soccer" && games.some((g) => g.sport_key === "soccer_fifa_world_cup")) {
      try {
        const finished = await cachedJson(
          "wc:finished:v2",
          2 * 60 * 1000,
          async (): Promise<Array<[string, string]>> => {
            const r = await fetch(
              "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
            );
            if (!r.ok) return [];
            const j = (await r.json()) as {
              events?: Array<{
                status?: { type?: { completed?: boolean } };
                competitions?: Array<{ competitors?: Array<{ team?: { id?: string | number } }> }>;
              }>;
            };
            const pairs: Array<[string, string]> = [];
            for (const e of j.events ?? []) {
              if (!e.status?.type?.completed) continue;
              const ids = (e.competitions?.[0]?.competitors ?? [])
                .map((c) => (c.team?.id != null ? String(c.team.id) : ""))
                .filter(Boolean);
              if (ids.length === 2) pairs.push([ids[0]!, ids[1]!]);
            }
            return pairs;
          },
        );
        if (finished.length) {
          // Match finished events to odds games by ESPN team ID, NOT by name.
          // ESPN and the Odds API spell several nations differently ("Czechia"
          // vs "Czech Republic", "Congo DR" vs "DR Congo", "Türkiye" vs
          // "Turkey"), so any name compare needs an ever-growing alias list and
          // still silently misses teams. Instead resolve each odds team to its
          // ESPN World Cup team ID with the SAME uniqueness-guarded resolver
          // that powers the WC crests, and read the scoreboard side's real
          // team.id — an exact, drift-proof key.
          const wcGames = games.filter((g) => g.sport_key === "soccer_fifa_world_cup");
          const idByGame = new Map<string, { home: string | null; away: string | null }>();
          await Promise.all(
            wcGames.map(async (g) => {
              const [h, a] = await Promise.all([
                resolveWorldCupTeam(g.home_team).catch(() => null),
                resolveWorldCupTeam(g.away_team).catch(() => null),
              ]);
              idByGame.set(g.id, { home: h?.id ?? null, away: a?.id ?? null });
            }),
          );
          // A WC game is finished when its two team IDs match a completed
          // event's two team IDs (either order) and EXACTLY ONE finished event
          // matches. Unresolved teams (null id) or any ambiguity fail OPEN so we
          // never drop a still-upcoming or live fixture.
          const isFinishedWc = (gameId: string): boolean => {
            const ids = idByGame.get(gameId);
            if (!ids || !ids.home || !ids.away) return false;
            return (
              finished.filter(
                ([a, b]) =>
                  (a === ids.home && b === ids.away) || (a === ids.away && b === ids.home),
              ).length === 1
            );
          };
          games = games.filter(
            (g) => g.sport_key !== "soccer_fifa_world_cup" || !isFinishedWc(g.id),
          );
        }
      } catch {
        // Fail-open: scoreboard unreachable → keep the games as-is.
      }
    }

    // Fan out alt fetches in parallel for each event that hasn't kicked
    // off yet and starts within the next 48h. Cap concurrency by
    // limiting how many games we even try per request. Per-event cache
    // is 10 min — alt markets are 5x credit cost so we don't want to
    // re-hit them on every poll.
    const americanToProb = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
    const now = Date.now();
    const WINDOW_MS = 48 * 60 * 60 * 1000;
    // Sports without halves/quarters (table tennis, tennis) skip the per-event
    // alt/period fetch entirely — those endpoints serve period ladders that
    // don't exist for them. Tennis still gets its main spreads/totals from the
    // bulk call above; it just has no per-event alt/period markets to add.
    const upcoming = skipAltPeriod ? [] : games.filter((g) => {
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
    // Period markets are SPORT-AWARE: basketball/football trade in
    // halves/quarters; baseball trades in INNINGS (First 5 Innings "F5" plus
    // the 1st-inning total). The Odds API uses entirely different keys for
    // each, so we pick the right set per game by its sport_key — requesting
    // quarter keys for an MLB game (or inning keys for an NBA game) just
    // returns nothing and wastes the per-event credit.
    const PERIOD_MARKETS_DEFAULT = [
      "alternate_spreads", "alternate_totals",
      "spreads_h1", "totals_h1", "h2h_h1",
      "spreads_h2", "totals_h2", "h2h_h2",
      "spreads_q1", "totals_q1", "h2h_q1",
      "spreads_q2", "totals_q2", "h2h_q2",
      "spreads_q3", "totals_q3", "h2h_q3",
      "spreads_q4", "totals_q4", "h2h_q4",
      "alternate_spreads_h1", "alternate_totals_h1",
    ];
    const PERIOD_MARKETS_BASEBALL = [
      "alternate_spreads", "alternate_totals",
      "h2h_1st_5_innings", "spreads_1st_5_innings", "totals_1st_5_innings",
      "totals_1st_1_innings",
    ];
    const periodMarketsFor = (sportKey: string) =>
      sportKey.startsWith("baseball") ? PERIOD_MARKETS_BASEBALL : PERIOD_MARKETS_DEFAULT;
    type Outcome = { name: string; price: number; point: number | null };
    const altByEvent = new Map<string, Map<string, Map<string, Outcome>>>();
    await Promise.all(
      upcoming.map(async (g) => {
        try {
          const gamePeriodMarkets = periodMarketsFor(g.sport_key);
          const evGame = await cachedJson(
            // Key the per-event alt/period fetch by the event's OWN sport_key
            // (which league/tour it belongs to) so merged multi-key sports hit
            // the correct endpoint and cache bucket. v3: baseball now requests
            // innings markets instead of the (empty) quarter/half set, so the
            // cache bucket is bumped to avoid serving stale empty v2 entries.
            `odds:${g.sport_key}:alt:${g.id}:v3`,
            10 * 60 * 1000,
            async () => {
              const url = `https://api.the-odds-api.com/v4/sports/${g.sport_key}/events/${g.id}/odds/?apiKey=${apiKey}&regions=us&markets=${gamePeriodMarkets.join(",")}&oddsFormat=american`;
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
              if (!gamePeriodMarkets.includes(m.key)) continue;
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

    const MAIN_MARKETS = ["h2h", "spreads", "totals"];
    const out = games.map((g) => {
      // Merge main markets across ALL bookmakers so we can both pick the
      // best price AND expose every book's price for line shopping. Group
      // by market key -> outcome (name|point) -> list of {book, price}.
      const mainByMarket = new Map<
        string,
        Map<string, { name: string; point: number | null; books: Array<{ book: string; price: number; point: number | null }> }>
      >();
      for (const b of g.bookmakers ?? []) {
        const bookName = b.title || b.key || "Book";
        for (const m of b.markets ?? []) {
          if (!MAIN_MARKETS.includes(m.key)) continue;
          let bucket = mainByMarket.get(m.key);
          if (!bucket) { bucket = new Map(); mainByMarket.set(m.key, bucket); }
          for (const o of m.outcomes ?? []) {
            const point = o.point ?? null;
            const k = `${o.name}|${point ?? ""}`;
            let entry = bucket.get(k);
            if (!entry) { entry = { name: o.name, point, books: [] }; bucket.set(k, entry); }
            entry.books.push({ book: bookName, price: Math.round(o.price), point });
          }
        }
      }
      const mainMarkets = MAIN_MARKETS.filter((key) => mainByMarket.get(key)?.size).map((key) => ({
        key,
        outcomes: Array.from(mainByMarket.get(key)!.values()).map((o) => {
          // Best price for the bettor = lowest implied probability. Sort
          // books best-first and surface that as the headline price.
          const books = o.books
            .slice()
            .sort((a, b) => americanToProb(a.price) - americanToProb(b.price))
            .slice(0, 10);
          const best = books[0];
          return {
            name: o.name,
            price: best ? best.price : 0,
            point: o.point,
            books,
          };
        }),
      }));
      const alt = altByEvent.get(g.id);
      const altMarkets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point: number | null }> }> = [];
      if (alt) {
        // Emit each period/alt market in a stable order so downstream
        // consumers (and the chat AI) see them grouped predictably.
        for (const key of periodMarketsFor(g.sport_key)) {
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

    // ── Real-odds fallback chain ─────────────────────────────────────────
    // When The Odds API returns nothing usable (out of monthly credits / 401
    // OUT_OF_USAGE_CREDITS / upstream error), every odds-driven surface — the
    // home "Upcoming" rail, the parlay builder, the chat Coach — would go
    // empty even though real games are on today. Fall back to ESPN pickcenter
    // lines, then Bovada; BOTH expose real bookmaker odds in this exact shape
    // (mains only — alt/period ladders are unavailable during the outage,
    // which is acceptable). Done SERVER-side so the web app AND the already-
    // installed mobile app recover transparently without a client release.
    // Sports outside the fallbacks' coverage (e.g. tennis) just stay empty.
    if (out.length === 0) {
      const selfPort = process.env["PORT"] || "8080";
      const selfBase = `http://127.0.0.1:${selfPort}`;
      const tryFallback = async (pathname: string): Promise<unknown[] | null> => {
        try {
          const r = await fetch(`${selfBase}${pathname}?sport=${encodeURIComponent(sportId)}`, {
            headers: { "x-internal-call": "1" },
          });
          if (!r.ok) return null;
          const list = (await r.json()) as unknown[];
          return Array.isArray(list) && list.length > 0 ? list : null;
        } catch {
          return null;
        }
      };
      const fallback =
        (await tryFallback("/api/sports/odds-espn")) ??
        (await tryFallback("/api/sports/odds-bovada"));
      if (fallback) {
        res.json(GetOddsResponse.parse(fallback));
        return;
      }
    }

    res.json(GetOddsResponse.parse(out));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch odds");
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Upstream error" });
  }
});

export default router;
