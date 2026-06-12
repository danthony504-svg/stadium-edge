import { Router, type IRouter } from "express";
import { GetGamesQueryParams, GetGamesResponse } from "@workspace/api-zod";
import { ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports";

const router: IRouter = Router();

type EspnEvent = {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status?: {
    clock?: number;
    displayClock?: string;
    period?: number;
    type?: { description?: string; state?: string; shortDetail?: string };
  };
  competitions?: Array<{
    venue?: { fullName?: string };
    status?: {
      clock?: number;
      displayClock?: string;
      period?: number;
      type?: { description?: string; state?: string; shortDetail?: string };
    };
    competitors?: Array<{
      homeAway: "home" | "away";
      score?: string;
      team?: { id?: string; displayName?: string; abbreviation?: string; logo?: string; logos?: Array<{ href?: string }> };
    }>;
  }>;
};

router.get("/sports/games", async (req, res): Promise<void> => {
  const parsed = GetGamesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sportId = parsed.data.sport.toLowerCase();
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }

  // ESPN's scoreboard endpoint defaults to *today's UTC date only*, which gives
  // ~1 NBA/NHL game and ~13 MLB games — making the app feel stale. Pulling a
  // wider window surfaces actual upcoming matchups (e.g. 100 MLB, 8 NHL).
  // IMPORTANT: start from YESTERDAY (UTC), not today — a game that began at
  // 2026-05-26T22:35Z is still LIVE at 2026-05-27T02:00Z, but a `?dates=2026
  // 0527-...` query excludes it (ESPN filters by event start-date, not by
  // live status), and the Pick Live tab ends up empty.
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${fmt(yesterday)}-${fmt(weekOut)}`;

  try {
    const data = await cachedJson(
      `games:${path}:${dateRange}`,
      60 * 1000,
      async () => {
        const fetchEspn = async (qs: string) => {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard${qs}`;
          const r = await fetch(url);
          if (!r.ok) throw new Error(`ESPN ${r.status}`);
          return (await r.json()) as { events?: EspnEvent[] };
        };
        // Primary: 7-day window (in-season leagues — NBA playoffs, MLB, NHL).
        const ranged = await fetchEspn(`?dates=${dateRange}&limit=200`);
        if ((ranged.events?.length ?? 0) > 0) return ranged;
        // Fallback: ESPN's default response (gives the next scheduled batch
        // for off-season leagues — e.g. NFL preseason/season opener).
        return await fetchEspn("");
      },
    );

    const out = (data.events ?? []).map((e) => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find((c) => c.homeAway === "home");
      const away = comp?.competitors?.find((c) => c.homeAway === "away");
      const homeScore = home?.score != null ? parseInt(home.score, 10) : null;
      const awayScore = away?.score != null ? parseInt(away.score, 10) : null;
      // Real in-game clock + period. ESPN exposes these on both the event
      // status and the competition status — prefer competition (more
      // reliable mid-game) and fall back to event.
      const statusObj = comp?.status ?? e.status;
      const displayClock = statusObj?.displayClock ?? null;
      const period = statusObj?.period ?? null;
      // shortDetail is the human-friendly "Q3 8:42" / "Bot 7th" / "HT" /
      // "Final" string ESPN ships for live scoreboards. Prefer it over the
      // generic description ("In Progress") so the UI shows what fans
      // actually see on ESPN.
      const periodLabel = statusObj?.type?.shortDetail ?? statusObj?.type?.description ?? null;
      return {
        id: e.id,
        sport: sportId,
        name: e.name,
        shortName: e.shortName,
        status: e.status?.type?.description
          ?? (e.status?.type?.state === "in" ? "In Progress"
              : e.status?.type?.state === "post" ? "Final"
              : e.status?.type?.state === "pre" ? "Scheduled"
              : "Unknown"),
        startsAt: e.date,
        homeTeam: home?.team?.displayName ?? null,
        awayTeam: away?.team?.displayName ?? null,
        homeScore: Number.isFinite(homeScore) ? homeScore : null,
        awayScore: Number.isFinite(awayScore) ? awayScore : null,
        homeTeamId: home?.team?.id ?? null,
        awayTeamId: away?.team?.id ?? null,
        homeLogo: home?.team?.logo ?? home?.team?.logos?.[0]?.href ?? null,
        awayLogo: away?.team?.logo ?? away?.team?.logos?.[0]?.href ?? null,
        homeAbbr: home?.team?.abbreviation ?? null,
        awayAbbr: away?.team?.abbreviation ?? null,
        venue: comp?.venue?.fullName ?? null,
        clock: displayClock,
        period,
        periodLabel,
        state: statusObj?.type?.state ?? e.status?.type?.state ?? null,
      };
    });

    res.json(GetGamesResponse.parse(out));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch games");
    res.json([]);
  }
});

// ESPN per-event "summary" endpoint carries live DraftKings odds
// (pickcenter[0]) for in-progress games — even when the scoreboard payload
// drops them once the game tips off. We use this as a fallback when our
// primary odds source (the-odds-api) is out of credits or paused, so the
// "Build best parlay from this game" pill on live cards still has real
// numbers to work from. Real bookmaker data only — never fabricated.
router.get("/sports/espn-odds", async (req, res): Promise<void> => {
  const sportId = String(req.query.sport || "").toLowerCase();
  const eventId = String(req.query.eventId || "");
  if (!sportId || !eventId) {
    res.status(400).json({ error: "sport and eventId required" });
    return;
  }
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  try {
    type Pickcenter = {
      provider?: { name?: string };
      details?: string;
      spread?: number;
      overUnder?: number;
      overOdds?: number;
      underOdds?: number;
      awayTeamOdds?: { moneyLine?: number; spreadOdds?: number };
      homeTeamOdds?: { moneyLine?: number; spreadOdds?: number };
    };
    type Summary = {
      pickcenter?: Pickcenter[];
      header?: { competitions?: Array<{ competitors?: Array<{ homeAway: "home" | "away"; team?: { displayName?: string } }> }> };
    };
    const data = await cachedJson<Summary>(
      `espn-odds:${path}:${eventId}`,
      30 * 1000, // live lines move fast — short TTL
      async () => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${eventId}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`ESPN ${r.status}`);
        return (await r.json()) as Summary;
      },
    );

    const pc = data.pickcenter?.[0];
    if (!pc) { res.json(null); return; }
    const comp = data.header?.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.displayName ?? null;
    const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.displayName ?? null;

    // ESPN's `spread` field is the home-team line (e.g. -3.5 when home is
    // favored by 3.5). Build the picks shape our analyzer expects. Each
    // market is only emitted when BOTH the line AND both real prices are
    // present — we never substitute a "-110" default for a missing price
    // (that would be fabrication, which the no-fake-data rule forbids).
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const mlH = num(pc.homeTeamOdds?.moneyLine);
    const mlA = num(pc.awayTeamOdds?.moneyLine);
    const sp = num(pc.spread);
    const spH = num(pc.homeTeamOdds?.spreadOdds);
    const spA = num(pc.awayTeamOdds?.spreadOdds);
    const tot = num(pc.overUnder);
    const totO = num(pc.overOdds);
    const totU = num(pc.underOdds);
    const out: Record<string, unknown> = {
      provider: pc.provider?.name ?? null,
      homeTeam: home,
      awayTeam: away,
      moneyline: mlH !== null && mlA !== null ? { home: mlH, away: mlA } : null,
      spread:
        sp !== null && spH !== null && spA !== null
          ? { homeLine: sp, awayLine: -sp, homePrice: spH, awayPrice: spA }
          : null,
      total:
        tot !== null && totO !== null && totU !== null
          ? { line: tot, over: totO, under: totU }
          : null,
    };
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch ESPN odds");
    res.json(null);
  }
});

// Bulk ESPN odds for an entire sport: iterates today's upcoming/live events
// from the scoreboard and pulls pickcenter[0] for each. Same shape as
// /api/sports/odds so the client can drop it in when The Odds API is out
// of credits. Real DraftKings (or whichever provider ESPN ships) lines
// only — never fabricated. Finished events (state="post") are dropped
// here so the consumer doesn't have to re-filter.
//
// Rate-limited because cold cache fans out to up to 40 ESPN summary
// calls per request. Responses are cached server-side (cachedJson), so the
// cap is only an abuse guard — keep it high enough that a legit full-slate
// fan-out (every selected sport cascading here when the paid feed is empty,
// across both the live + chat effects) doesn't trip false 429s and silently
// drop sports from the pool. Behind the proxy this counts per shared IP.
router.use("/sports/odds-espn", rateLimit({ windowMs: 60_000, max: 120, name: "odds-espn" }));
router.get("/sports/odds-espn", async (req, res): Promise<void> => {
  const sportId = String(req.query.sport || "").toLowerCase();
  const path = ESPN_SPORT_PATHS[sportId];
  if (!path) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  try {
    // Scoreboard window: yesterday → +7 days, same as /sports/games so live
    // games that started yesterday UTC are still included.
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dateRange = `${fmt(yesterday)}-${fmt(weekOut)}`;

    type ScoreboardEvent = {
      id: string;
      date: string;
      status?: { type?: { state?: string; description?: string } };
      competitions?: Array<{
        status?: { type?: { state?: string } };
        competitors?: Array<{
          homeAway: "home" | "away";
          team?: { displayName?: string };
        }>;
      }>;
    };

    // Separate cache namespace from /sports/games so this route's
    // no-fallback fetcher can't poison that route's cache with an empty
    // result and skip its ranged→default fallback.
    const scoreboard = await cachedJson<{ events?: ScoreboardEvent[] }>(
      `scoreboard-odds:${path}:${dateRange}`,
      60 * 1000,
      async () => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateRange}&limit=200`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`ESPN ${r.status}`);
        return (await r.json()) as { events?: ScoreboardEvent[] };
      },
    );

    // Skip finished games entirely. Cap at 40 events per sport so we don't
    // hammer ESPN's summary endpoint — comfortably covers a full MLB or
    // soccer slate.
    const events = (scoreboard.events ?? []).filter((e) => {
      const state = e.competitions?.[0]?.status?.type?.state ?? e.status?.type?.state;
      return state !== "post";
    }).slice(0, 40);

    // Bounded concurrency: at most 6 ESPN summary calls in flight at once
    // so we don't trip ESPN rate limits on a cold cache for big MLB slates.
    const runWithLimit = async <T,>(items: ScoreboardEvent[], limit: number, fn: (e: ScoreboardEvent) => Promise<T>): Promise<T[]> => {
      const out: T[] = new Array(items.length);
      let next = 0;
      const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= items.length) return;
          const item = items[i];
          if (item) out[i] = await fn(item);
        }
      });
      await Promise.all(workers);
      return out;
    };

    type Pickcenter = {
      provider?: { name?: string };
      spread?: number;
      overUnder?: number;
      overOdds?: number;
      underOdds?: number;
      awayTeamOdds?: { moneyLine?: number; spreadOdds?: number };
      homeTeamOdds?: { moneyLine?: number; spreadOdds?: number };
    };
    type Summary = { pickcenter?: Pickcenter[] };

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    const results = await runWithLimit(events, 6, async (e) => {
      try {
        // Use the SAME 30s TTL/key as the per-event /sports/espn-odds
        // route so a live-card analyzer call and a bulk-odds call share
        // the same cache entry — and so neither route serves the other's
        // stale 5-minute data.
        const summary = await cachedJson<Summary>(
          `espn-odds:${path}:${e.id}`,
          30 * 1000,
          async () => {
            const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${e.id}`;
            const r = await fetch(url);
            if (!r.ok) throw new Error(`ESPN ${r.status}`);
            return (await r.json()) as Summary;
          },
        );
        const pc = summary.pickcenter?.[0];
        if (!pc) return null;

        const comp = e.competitions?.[0];
        const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.displayName ?? null;
        const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.displayName ?? null;
        if (!home || !away) return null;

        const markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point: number | null }> }> = [];
        const mlH = num(pc.homeTeamOdds?.moneyLine);
        const mlA = num(pc.awayTeamOdds?.moneyLine);
        if (mlH !== null && mlA !== null) {
          markets.push({
            key: "h2h",
            outcomes: [
              { name: home, price: Math.round(mlH), point: null },
              { name: away, price: Math.round(mlA), point: null },
            ],
          });
        }
        const sp = num(pc.spread);
        const spH = num(pc.homeTeamOdds?.spreadOdds);
        const spA = num(pc.awayTeamOdds?.spreadOdds);
        if (sp !== null && spH !== null && spA !== null) {
          markets.push({
            key: "spreads",
            outcomes: [
              { name: home, price: Math.round(spH), point: sp },
              { name: away, price: Math.round(spA), point: -sp },
            ],
          });
        }
        const tot = num(pc.overUnder);
        const totO = num(pc.overOdds);
        const totU = num(pc.underOdds);
        if (tot !== null && totO !== null && totU !== null) {
          markets.push({
            key: "totals",
            outcomes: [
              { name: "Over", price: Math.round(totO), point: tot },
              { name: "Under", price: Math.round(totU), point: tot },
            ],
          });
        }
        if (markets.length === 0) return null;
        return { id: e.id, sport: sportId, homeTeam: home, awayTeam: away, commenceTime: e.date, markets };
      } catch {
        return null;
      }
    });

    res.json(results.filter((g) => g !== null));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch ESPN bulk odds");
    res.json([]);
  }
});

// Third-tier odds fallback: Bovada's free public coupon JSON endpoint.
// Used when BOTH The Odds API and ESPN pickcenter are unavailable. Same
// response shape as /api/sports/odds so the client can drop it in. Real
// Bovada lines only — never fabricated. Pre-match only (preMatchOnly=true)
// which inherently excludes finished games.
// Bovada sport paths. UFC/MMA omitted — Bovada's current taxonomy doesn't
// expose it under any of the obvious paths (all return 404), so the chain
// just falls through for UFC.
const BOVADA_PATHS: Record<string, string> = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nfl: "football/nfl",
  nhl: "hockey/nhl",
  ncaaf: "football/college-football",
  ncaab: "basketball/college-basketball",
  soccer: "soccer",
  tabletennis: "table-tennis",
};
// Cached server-side; cap is an abuse guard only. Match odds-espn so a
// full-slate fallback fan-out across both fetch effects can't false-429 and
// thin the pool. Per shared proxy IP.
router.use("/sports/odds-bovada", rateLimit({ windowMs: 60_000, max: 120, name: "odds-bovada" }));
router.get("/sports/odds-bovada", async (req, res): Promise<void> => {
  const sportId = String(req.query.sport || "").toLowerCase();
  const bvPath = BOVADA_PATHS[sportId];
  if (!bvPath) {
    res.status(400).json({ error: `Unsupported sport: ${sportId}` });
    return;
  }
  try {
    type BvOutcome = {
      description?: string;
      type?: string; // "A" away, "H" home, "O" over, "U" under
      competitorId?: string;
      price?: { american?: string; handicap?: string };
    };
    type BvMarket = {
      description?: string;
      key?: string; // "2W-12" h2h, "2W-HCAP" spread, "2W-OU" total
      period?: { description?: string };
      outcomes?: BvOutcome[];
    };
    type BvEvent = {
      id: string;
      description?: string;
      startTime?: number;
      live?: boolean;
      competitors?: Array<{ id: string; name: string; home: boolean }>;
      displayGroups?: Array<{ description?: string; markets?: BvMarket[] }>;
    };
    type BvPayload = Array<{ events?: BvEvent[] }>;

    const data = await cachedJson<BvPayload>(
      `odds-bovada:${bvPath}`,
      60 * 1000,
      async () => {
        const url = `https://www.bovada.lv/services/sports/event/coupon/events/A/description/${bvPath}?marketFilterId=def&preMatchOnly=true&lang=en`;
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
        if (!r.ok) throw new Error(`Bovada ${r.status}`);
        return (await r.json()) as BvPayload;
      },
    );

    const parseAmerican = (s?: string): number | null => {
      if (!s) return null;
      const n = parseInt(s.replace(/^\+/, ""), 10);
      return Number.isFinite(n) ? n : null;
    };
    const parseHcap = (s?: string): number | null => {
      if (!s) return null;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };

    const out: Array<{
      id: string; sport: string; homeTeam: string; awayTeam: string; commenceTime: string;
      markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point: number | null }> }>;
    }> = [];

    // Soccer payload is multi-container (one per league); ball-sports are
    // single-container. Flatten everything before iterating.
    const events: BvEvent[] = data.flatMap((c) => c.events ?? []);
    // Accept full-game periods across all sports. Bovada labels this as
    // "Game" for US sports and "Regulation Time" for soccer; both mean
    // 90/60/9-inning full result excluding ET/penalties/extra innings,
    // which is what every bookmaker market we render is settled on.
    const isFullGamePeriod = (p?: string) => {
      const x = (p ?? "").toLowerCase();
      return x === "game" || x === "regulation time" || x === "full game" || x === "match";
    };
    for (const ev of events) {
      const homeC = ev.competitors?.find((c) => c.home);
      const awayC = ev.competitors?.find((c) => !c.home);
      const home = homeC?.name;
      const away = awayC?.name;
      if (!home || !away || !ev.startTime) continue;
      const markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point: number | null }> }> = [];
      const gameMarkets = (ev.displayGroups?.[0]?.markets ?? []).filter(
        (m) => isFullGamePeriod(m.period?.description),
      );
      // Side-match by `type` first (H/A/O/U/D — stable across naming
      // variations), fall back to competitorId, then description.
      const findSide = (m: BvMarket, type: string, name: string, cid?: string) =>
        m.outcomes?.find((o) => o.type === type)
        ?? (cid ? m.outcomes?.find((o) => o.competitorId === cid) : undefined)
        ?? m.outcomes?.find((o) => o.description === name);
      for (const m of gameMarkets) {
        // Moneyline: 2W-12 (US sports, no draw) OR 3W-1X2 (soccer, 3-way
        // with draw). We surface only the two team prices; downstream
        // doesn't render draws today.
        if (m.key === "2W-12" || m.key === "3W-1X2") {
          const homeOut = findSide(m, "H", home, homeC?.id);
          const awayOut = findSide(m, "A", away, awayC?.id);
          const hp = parseAmerican(homeOut?.price?.american);
          const ap = parseAmerican(awayOut?.price?.american);
          if (hp !== null && ap !== null) {
            markets.push({ key: "h2h", outcomes: [
              { name: home, price: hp, point: null },
              { name: away, price: ap, point: null },
            ]});
          }
        } else if (m.key === "2W-HCAP") {
          const homeOut = findSide(m, "H", home, homeC?.id);
          const awayOut = findSide(m, "A", away, awayC?.id);
          const hp = parseAmerican(homeOut?.price?.american);
          const ap = parseAmerican(awayOut?.price?.american);
          const hh = parseHcap(homeOut?.price?.handicap);
          const ah = parseHcap(awayOut?.price?.handicap);
          if (hp !== null && ap !== null && hh !== null && ah !== null) {
            markets.push({ key: "spreads", outcomes: [
              { name: home, price: hp, point: hh },
              { name: away, price: ap, point: ah },
            ]});
          }
        } else if (m.key === "2W-OU") {
          const overOut = m.outcomes?.find((o) => o.type === "O") ?? m.outcomes?.find((o) => /over/i.test(o.description ?? ""));
          const underOut = m.outcomes?.find((o) => o.type === "U") ?? m.outcomes?.find((o) => /under/i.test(o.description ?? ""));
          const op = parseAmerican(overOut?.price?.american);
          const up = parseAmerican(underOut?.price?.american);
          const line = parseHcap(overOut?.price?.handicap) ?? parseHcap(underOut?.price?.handicap);
          if (op !== null && up !== null && line !== null) {
            markets.push({ key: "totals", outcomes: [
              { name: "Over", price: op, point: line },
              { name: "Under", price: up, point: line },
            ]});
          }
        }
      }
      if (markets.length === 0) continue;
      out.push({
        id: ev.id,
        sport: sportId,
        homeTeam: home,
        awayTeam: away,
        commenceTime: new Date(ev.startTime).toISOString(),
        markets,
      });
    }
    res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Bovada odds");
    res.json([]);
  }
});

export default router;
