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

export default router;
