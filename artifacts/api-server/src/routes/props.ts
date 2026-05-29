import { Router, type IRouter } from "express";
import { ODDS_SPORT_KEYS, ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports";

const router: IRouter = Router();

// Raised from 30 → 120/min: a single chat parlay request fans out up to
// 12 prop fetches in one burst, and a user opening 2-3 game-detail pages
// before that easily blew the old 30/min cap, returning silent 429s that
// left realPropsByEvent empty client-side and made the AI say "realProps
// is empty" even when HR markets were available upstream.
router.use("/sports/props", rateLimit({ windowMs: 60_000, max: 120 }));

const MARKETS_BY_SPORT: Record<string, string[]> = {
  nba: ["player_points", "player_rebounds", "player_assists", "player_threes", "player_points_rebounds_assists", "player_points_rebounds", "player_points_assists", "player_rebounds_assists", "player_blocks", "player_steals", "player_blocks_steals", "player_turnovers"],
  ncaab: ["player_points", "player_rebounds", "player_assists"],
  nfl: ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_receptions", "player_anytime_td"],
  ncaaf: ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_anytime_td"],
  mlb: ["batter_hits", "batter_total_bases", "batter_home_runs", "pitcher_strikeouts"],
  nhl: ["player_points", "player_goals", "player_assists", "player_shots_on_goal"],
};

// Quarter / half player markets — fetched as a SEPARATE Odds API call so a
// 422 on an unsupported market segment can't wipe out the base props above.
// The result is merged into the same per-(player, market, line) aggregation
// downstream; the unique market keys keep them distinct from full-game props.
//
// IMPORTANT: the Odds API rejects the ENTIRE batch with INVALID_MARKET if
// even one market name in the list is unsupported, so this allowlist is
// constrained to markets verified via direct probe of the Odds API:
//   NBA: only _q1 for points/rebounds/assists (threes_q1 and ALL _h1 invalid)
//   NFL: _q1 + _h1 for pass/rush/reception yds (+ pass_tds_q1); NOT receptions_q1
//   NCAAF: _q1 + _h1 for pass/rush/reception yds
//   NCAAB: no QH markets are supported by the Odds API today — omit entirely
// If you add a new key here you MUST probe it on a live event first.
const QH_MARKETS_BY_SPORT: Record<string, string[]> = {
  nba: [
    "player_points_q1", "player_rebounds_q1", "player_assists_q1",
  ],
  nfl: [
    "player_pass_yds_q1", "player_pass_tds_q1", "player_rush_yds_q1", "player_reception_yds_q1",
    "player_pass_yds_h1", "player_rush_yds_h1", "player_reception_yds_h1",
  ],
  ncaaf: [
    "player_pass_yds_q1", "player_rush_yds_q1", "player_reception_yds_q1",
    "player_pass_yds_h1", "player_rush_yds_h1", "player_reception_yds_h1",
  ],
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

// Fetch ESPN roster for a team and return a Map of normalized player name →
// { headshot, athleteId, teamId }. We need athleteId + teamId so the client
// can pull each player's real game log (last 10 + vs-opponent split) from
// the /sports/player-history endpoint when building parlays with real
// player-prop analytics, not just bookmaker odds.
const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
type RosterAthlete = { id?: string | number; fullName?: string; displayName?: string; headshot?: { href?: string } | string };
type EspnRoster = { athletes?: Array<RosterAthlete | { items?: RosterAthlete[]; position?: string }> };
type RosterEntry = { headshot: string | null; athleteId: string | null; teamId: string };
async function fetchRosterMap(espnPath: string, teamId: string): Promise<Map<string, RosterEntry>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${teamId}/roster`;
  const data = await cachedJson<EspnRoster>(`roster:${espnPath}:${teamId}`, 6 * 60 * 60 * 1000, async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ESPN roster ${r.status}`);
    return (await r.json()) as EspnRoster;
  });
  const m = new Map<string, RosterEntry>();
  // ESPN ships rosters in two shapes depending on sport: a flat
  // `athletes` array, or a position-grouped array of `{position, items}`.
  // Flatten both into one list so the lookup works across all sports.
  const flat: RosterAthlete[] = [];
  for (const entry of data.athletes ?? []) {
    if (entry && typeof entry === "object" && "items" in entry && Array.isArray((entry as { items?: RosterAthlete[] }).items)) {
      flat.push(...((entry as { items: RosterAthlete[] }).items));
    } else {
      flat.push(entry as RosterAthlete);
    }
  }
  for (const a of flat) {
    const name = a.fullName ?? a.displayName;
    if (!name) continue;
    const href = typeof a.headshot === "string" ? a.headshot : a.headshot?.href;
    const athleteId = a.id != null ? String(a.id) : null;
    m.set(normalizeName(name), { headshot: href ?? null, athleteId, teamId });
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
    const fetchOdds = async (mkList: string[]) => {
      const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${mkList.join(",")}&oddsFormat=american`;
      const r = await fetch(url);
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
      }
      return (await r.json()) as RawEventOdds;
    };

    const qhMarkets = QH_MARKETS_BY_SPORT[sport] ?? [];
    const [data, qhData] = await Promise.all([
      cachedJson<RawEventOdds>(`props:${oddsKey}:${eventId}`, 5 * 60 * 1000, () => fetchOdds(markets)),
      qhMarkets.length
        ? cachedJson<RawEventOdds | null>(`props-qh:${oddsKey}:${eventId}:v2`, 5 * 60 * 1000, async () => {
            // Honest fallback: if a quarter/half segment 422s for this sport/event
            // (e.g. game not in-window for QH lines yet) we return null and keep
            // the base props rather than failing the whole request.
            try { return await fetchOdds(qhMarkets); } catch { return null; }
          })
        : Promise.resolve(null),
    ]);

    // Union player markets across ALL bookmakers (base + quarter/half),
    // keeping the BEST price per (player, market, line, side). Earlier this
    // only scanned bookmakers[0], which silently dropped entire prop markets
    // (e.g. HRs) whenever the first-listed book didn't post that market for a
    // given game even though another book did. Best-price aggregation is also
    // what a sharp user expects — show the most beatable line available
    // across the US books. Best = higher American number when both positive,
    // less-negative when both negative; sign change always favors the
    // positive (plus money).
    const americanToProb = (a: number) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
    const betterAmerican = (a: number, b: number) => (americanToProb(a) < americanToProb(b) ? a : b);
    const byKey = new Map<string, { player: string; market: string; line: number | null; overPrice: number | null; underPrice: number | null }>();
    const sources: Array<RawEventOdds | null> = [data, qhData];
    for (const src of sources) {
      if (!src) continue;
      for (const book of src.bookmakers ?? []) {
        for (const m of book.markets ?? []) {
          for (const o of m.outcomes ?? []) {
            const player = o.description ?? "—";
            const line = o.point ?? null;
            const k = `${player}|${m.key}|${line ?? "_"}`;
            const row = byKey.get(k) ?? { player, market: m.key, line, overPrice: null, underPrice: null };
            const price = Math.round(o.price);
            const side = o.name.toLowerCase();
            if (side === "over" || side === "yes") {
              row.overPrice = row.overPrice == null ? price : betterAmerican(row.overPrice, price);
            } else if (side === "under" || side === "no") {
              row.underPrice = row.underPrice == null ? price : betterAmerican(row.underPrice, price);
            }
            byKey.set(k, row);
          }
        }
      }
    }

    // Enrich with player headshot + ESPN athleteId + their team id from
    // each team's roster. athleteId/playerTeamId let the client fetch each
    // player's real game log for prop-analytics in the parlay builder.
    let rosterMap: Map<string, RosterEntry> | null = null;
    const espnPath = ESPN_SPORT_PATHS[sport];
    if (espnPath && (homeTeamId || awayTeamId)) {
      const maps = await Promise.all(
        [homeTeamId, awayTeamId].filter(Boolean).map((tid) =>
          fetchRosterMap(espnPath, tid).catch(() => new Map<string, RosterEntry>()),
        ),
      );
      rosterMap = new Map<string, RosterEntry>();
      for (const m of maps) for (const [k, v] of m) rosterMap.set(k, v);
    }

    const props = Array.from(byKey.values()).map((p) => {
      const r = rosterMap?.get(normalizeName(p.player));
      return {
        ...p,
        headshot: r?.headshot ?? null,
        athleteId: r?.athleteId ?? null,
        playerTeamId: r?.teamId ?? null,
      };
    });

    res.json({
      home: data.home_team ?? null,
      away: data.away_team ?? null,
      bookmaker: Array.from(new Set((data.bookmakers ?? []).map((b) => b.title).filter(Boolean))).join(", ") || null,
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
