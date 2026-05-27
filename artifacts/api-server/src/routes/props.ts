import { Router, type IRouter } from "express";
import { ODDS_SPORT_KEYS, ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports";

const router: IRouter = Router();

router.use("/sports/props", rateLimit({ windowMs: 60_000, max: 30 }));

const MARKETS_BY_SPORT: Record<string, string[]> = {
  nba: ["player_points", "player_rebounds", "player_assists", "player_threes", "player_points_rebounds_assists"],
  ncaab: ["player_points", "player_rebounds", "player_assists"],
  nfl: ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_receptions", "player_anytime_td"],
  ncaaf: ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_anytime_td"],
  mlb: ["batter_hits", "batter_total_bases", "batter_home_runs", "pitcher_strikeouts"],
  nhl: ["player_points", "player_goals", "player_assists", "player_shots_on_goal"],
};

type RawEventOdds = {
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    title?: string;
    markets?: Array<{
      key: string;
      outcomes?: Array<{ name: string; description?: string; price: number; point?: number }>;
    }>;
  }>;
};

// Fetch ESPN roster for a team and return a Map of normalized player name → headshot URL.
const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
type EspnRoster = { athletes?: Array<{ fullName?: string; displayName?: string; headshot?: { href?: string } | string }> };
async function fetchHeadshotMap(espnPath: string, teamId: string): Promise<Map<string, string>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${teamId}/roster`;
  const data = await cachedJson<EspnRoster>(`roster:${espnPath}:${teamId}`, 6 * 60 * 60 * 1000, async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ESPN roster ${r.status}`);
    return (await r.json()) as EspnRoster;
  });
  const m = new Map<string, string>();
  for (const a of data.athletes ?? []) {
    const name = a.fullName ?? a.displayName;
    const href = typeof a.headshot === "string" ? a.headshot : a.headshot?.href;
    if (name && href) m.set(normalizeName(name), href);
  }
  return m;
}

router.get("/sports/props", async (req, res): Promise<void> => {
  const sport = String(req.query["sport"] || "").toLowerCase();
  const eventId = String(req.query["eventId"] || "");
  const homeTeamId = String(req.query["homeTeamId"] || "");
  const awayTeamId = String(req.query["awayTeamId"] || "");
  if (!sport || !eventId) {
    res.status(400).json({ error: "sport and eventId are required" });
    return;
  }
  const oddsKey = ODDS_SPORT_KEYS[sport];
  if (!oddsKey) {
    res.status(400).json({ error: `Unsupported sport: ${sport}` });
    return;
  }
  const markets = MARKETS_BY_SPORT[sport];
  if (!markets) {
    res.json({ home: null, away: null, props: [] });
    return;
  }
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "ODDS_API_KEY not configured" });
    return;
  }

  try {
    const data = await cachedJson<RawEventOdds>(
      `props:${oddsKey}:${eventId}`,
      5 * 60 * 1000,
      async () => {
        const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${markets.join(",")}&oddsFormat=american`;
        const r = await fetch(url);
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
        }
        return (await r.json()) as RawEventOdds;
      },
    );

    // Flatten the first bookmaker's player markets into a clean list.
    // Each row: { player, market, line, overPrice, underPrice }.
    const book = data.bookmakers?.[0];
    const byKey = new Map<string, { player: string; market: string; line: number | null; overPrice: number | null; underPrice: number | null }>();
    for (const m of book?.markets ?? []) {
      for (const o of m.outcomes ?? []) {
        const player = o.description ?? "—";
        const line = o.point ?? null;
        const k = `${player}|${m.key}|${line ?? "_"}`;
        const row = byKey.get(k) ?? { player, market: m.key, line, overPrice: null, underPrice: null };
        if (o.name.toLowerCase() === "over") row.overPrice = Math.round(o.price);
        else if (o.name.toLowerCase() === "under") row.underPrice = Math.round(o.price);
        else if (o.name.toLowerCase() === "yes") row.overPrice = Math.round(o.price);
        else if (o.name.toLowerCase() === "no") row.underPrice = Math.round(o.price);
        byKey.set(k, row);
      }
    }

    // Optionally enrich with player headshots from ESPN team rosters.
    let headshots: Map<string, string> | null = null;
    const espnPath = ESPN_SPORT_PATHS[sport];
    if (espnPath && (homeTeamId || awayTeamId)) {
      const maps = await Promise.all(
        [homeTeamId, awayTeamId].filter(Boolean).map((tid) =>
          fetchHeadshotMap(espnPath, tid).catch(() => new Map<string, string>()),
        ),
      );
      headshots = new Map<string, string>();
      for (const m of maps) for (const [k, v] of m) headshots.set(k, v);
    }

    const props = Array.from(byKey.values()).map((p) => ({
      ...p,
      headshot: headshots?.get(normalizeName(p.player)) ?? null,
    }));

    res.json({
      home: data.home_team ?? null,
      away: data.away_team ?? null,
      bookmaker: book?.title ?? null,
      props,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch player props");
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : "Upstream error" });
  }
});

// ---------------------------------------------------------------------------
// PrizePicks fallback: when the paid odds-API has no player-prop data for a
// game (quota out, off-market, etc.), we fall back to PrizePicks' public
// projections endpoint. IMPORTANT: PrizePicks is a DFS pick'em product, so
// each projection has a real LINE but NO per-leg American odds — the upstream
// payout is parlay-only. We surface the line + stat type honestly and the
// client renders the leg with "PrizePicks line · standard payout" instead of
// fabricating a price. The leg cannot contribute to combined-odds math.
// ---------------------------------------------------------------------------
const PRIZEPICKS_LEAGUE_BY_SPORT: Record<string, number> = {
  nba: 7, nfl: 9, mlb: 2, nhl: 8, ncaaf: 15, ncaab: 20,
};

router.use("/sports/prizepicks-props", rateLimit({ windowMs: 60_000, max: 30 }));

type PPProjection = {
  id: string;
  attributes?: {
    line_score?: number;
    stat_type?: string;
    description?: string;
    is_live?: boolean;
    status?: string;
    start_time?: string;
  };
  relationships?: { new_player?: { data?: { id?: string } } };
};
type PPIncluded = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
};

router.get("/sports/prizepicks-props", async (req, res): Promise<void> => {
  const sport = String(req.query["sport"] || "").toLowerCase();
  const home = String(req.query["home"] || "").trim();
  const away = String(req.query["away"] || "").trim();
  if (!sport || !home || !away) {
    res.status(400).json({ error: "sport, home, and away are required" });
    return;
  }
  const leagueId = PRIZEPICKS_LEAGUE_BY_SPORT[sport];
  if (!leagueId) {
    res.json({ source: "PrizePicks", home, away, props: [] });
    return;
  }

  try {
    type PPPayload = { data?: PPProjection[]; included?: PPIncluded[] };
    const data = await cachedJson<PPPayload>(
      `pp:${leagueId}`,
      90 * 1000,
      async () => {
        const url = `https://api.prizepicks.com/projections?league_id=${leagueId}&per_page=250&single_stat=true`;
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; stadium-edge/1.0)" } });
        if (!r.ok) throw new Error(`PrizePicks ${r.status}`);
        return (await r.json()) as PPPayload;
      },
    );

    // Index `included` so we can resolve a projection's player → team full name.
    // A team entity has { market: "San Antonio", name: "Spurs" } — combined
    // they form the ESPN-style full name we match against.
    const teamFullByAbbr = new Map<string, string>();
    const playerById = new Map<string, { name: string; teamAbbr: string; teamFull: string; image: string | null }>();
    for (const inc of data.included ?? []) {
      if (inc.type === "team") {
        const a = inc.attributes ?? {};
        const abbr = String(a["abbreviation"] ?? "");
        const market = String(a["market"] ?? "");
        const name = String(a["name"] ?? "");
        if (abbr && market && name) teamFullByAbbr.set(abbr, `${market} ${name}`);
      }
    }
    for (const inc of data.included ?? []) {
      if (inc.type === "new_player") {
        const a = inc.attributes ?? {};
        const teamAbbr = String(a["team"] ?? "");
        // Prefer the dynamic team-entity lookup; fall back to the player's
        // own `market` + `team_name` (also full-form on PrizePicks).
        const teamFull =
          teamFullByAbbr.get(teamAbbr) ||
          `${String(a["market"] ?? "")} ${String(a["team_name"] ?? "")}`.trim();
        playerById.set(inc.id, {
          name: String(a["display_name"] ?? a["name"] ?? ""),
          teamAbbr,
          teamFull,
          image: typeof a["image_url"] === "string" ? (a["image_url"] as string) : null,
        });
      }
    }

    const wantedFull = new Set([home, away]);
    const props: Array<{
      player: string;
      market: string;
      line: number | null;
      team: string;
      teamFull: string;
      isLive: boolean;
      headshot: string | null;
    }> = [];
    for (const p of data.data ?? []) {
      const playerId = p.relationships?.new_player?.data?.id;
      if (!playerId) continue;
      const pl = playerById.get(playerId);
      if (!pl) continue;
      if (!wantedFull.has(pl.teamFull)) continue;
      const a = p.attributes ?? {};
      const line = typeof a.line_score === "number" ? a.line_score : null;
      const stat = a.stat_type ?? null;
      if (!stat || line == null) continue;
      props.push({
        player: pl.name,
        market: String(stat),
        line,
        team: pl.teamAbbr,
        teamFull: pl.teamFull,
        isLive: Boolean(a.is_live),
        headshot: pl.image,
      });
    }

    res.json({ source: "PrizePicks", home, away, props });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch PrizePicks props");
    // Honest empty response — client treats as "no PrizePicks lines available".
    res.json({ source: "PrizePicks", home, away, props: [] });
  }
});

export default router;
