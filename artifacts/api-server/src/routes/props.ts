import { Router, type IRouter } from "express";
import { ODDS_SPORT_KEYS, ESPN_SPORT_PATHS, cachedJson, rateLimit } from "../lib/sports";

const router: IRouter = Router();

// The upstream Odds API enforces a per-SECOND frequency limit (HTTP 429,
// EXCEEDED_FREQ_LIMIT) that is separate from the monthly quota. A cold-cache
// chat-context build fans out many per-event prop requests at once, and a
// MULTI-KEY sport (soccer) additionally fires one events-list lookup per league
// BEFORE its props fetch — so soccer reliably trips the per-second limit. The
// base props fetch had no retry, so it threw → the route returned 502 → the
// client saw zero soccer props → the AI coach honestly but wrongly refused to
// build a soccer prop parlay even though props were available upstream.
//
// A short bounded backoff+jitter rides out the sub-second window. We retry only
// transient failures (429 + 5xx); a 4xx like 422 (unsupported market) fails
// fast. On success the result is cached 5 min, so only the cold burst pays this
// cost. Jitter de-syncs concurrent retries so they don't collide in lockstep.
async function fetchOddsApi(url: string, attempts = 4): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(url);
    if (r.ok) return r;
    const retryable = r.status === 429 || r.status >= 500;
    if (!retryable || i === attempts - 1) return r;
    // Drain the body so the socket can be reused before backing off.
    await r.text().catch(() => {});
    const backoff = 200 * 2 ** i + Math.floor(Math.random() * 150);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  // Unreachable (the loop always returns on the last attempt), but satisfies the
  // type checker that a Response is always produced.
  return fetch(url);
}

// Raised from 30 → 120/min: a single chat parlay request fans out up to
// 12 prop fetches in one burst, and a user opening 2-3 game-detail pages
// before that easily blew the old 30/min cap, returning silent 429s that
// left realPropsByEvent empty client-side and made the AI say "realProps
// is empty" even when HR markets were available upstream.
router.use("/sports/props", rateLimit({ windowMs: 60_000, max: 120, name: "props" }));

export const MARKETS_BY_SPORT: Record<string, string[]> = {
  nba: ["player_points", "player_rebounds", "player_assists", "player_threes", "player_points_rebounds_assists", "player_points_rebounds", "player_points_assists", "player_rebounds_assists", "player_blocks", "player_steals", "player_blocks_steals", "player_turnovers"],
  wnba: ["player_points", "player_rebounds", "player_assists", "player_threes", "player_points_rebounds_assists", "player_points_rebounds", "player_points_assists", "player_rebounds_assists", "player_blocks", "player_steals", "player_blocks_steals", "player_turnovers"],
  ncaab: ["player_points", "player_rebounds", "player_assists"],
  nfl: ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_receptions", "player_anytime_td", "player_sacks"],
  ncaaf: ["player_pass_yds", "player_pass_tds", "player_rush_yds", "player_reception_yds", "player_anytime_td"],
  mlb: ["batter_hits", "batter_total_bases", "batter_home_runs", "pitcher_strikeouts", "batter_stolen_bases"],
  nhl: ["player_points", "player_goals", "player_assists", "player_shots_on_goal"],
  // Soccer: only the FIFA World Cup currently carries player props on our feed
  // (anytime goalscorer is a YES/NO market like anytime TD; shots / shots on
  // target are over/under). Club leagues post no player props in any region, so
  // those events simply return [] honestly. Soccer is MULTI-KEY, so the handler
  // resolves the event's real league before fetching (see below).
  soccer: ["player_goal_scorer_anytime", "player_shots_on_target", "player_shots"],
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
  // WNBA: only player_points_q1 is verified on a live event; reb/ast Q1 were
  // not confirmed and the QH batch is all-or-nothing (one bad key 422s the
  // whole call), so keep this to the confirmed market to guarantee Q1 data.
  wnba: [
    "player_points_q1",
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

// Alternate-line player markets — the real bookmaker LADDER around each main
// prop line (e.g. points at 17.5 / 19.5 / 24.5 / 29.5 / 34.5 ...). Fetched as
// a SEPARATE Odds API call (same all-or-nothing 422 caveat as QH markets, so a
// bad key just returns null and leaves the base props intact). The "_alternate"
// suffix is stripped downstream so each rung folds into the SAME (player, stat)
// bucket as the main line — giving the AI a real cushion/value ladder instead
// of only the single posted number. Keys here are the documented Odds API
// alternate keys; probe any new key on a live event before adding it.
const ALT_MARKETS_BY_SPORT: Record<string, string[]> = {
  nba: ["player_points_alternate", "player_rebounds_alternate", "player_assists_alternate", "player_threes_alternate"],
  wnba: ["player_points_alternate", "player_rebounds_alternate", "player_assists_alternate", "player_threes_alternate"],
  ncaab: ["player_points_alternate", "player_rebounds_alternate", "player_assists_alternate"],
  nfl: ["player_pass_yds_alternate", "player_pass_tds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate", "player_receptions_alternate"],
  ncaaf: ["player_pass_yds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate"],
  mlb: ["batter_hits_alternate", "batter_total_bases_alternate", "batter_home_runs_alternate", "pitcher_strikeouts_alternate"],
  nhl: ["player_points_alternate", "player_assists_alternate", "player_shots_on_goal_alternate"],
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

// World Cup (national-team) crest + headshot resolution. World Cup soccer props
// carry NO team id, NO team field, and ESPN's club-league feeds don't list the
// national teams, so the odds feed's team NAMES are the only handle we have. We
// resolve both nations from ESPN's FIFA World Cup teams list (a CLOSED 48-team
// set, so fuzzy matching is uniqueness-guarded and FAIL-CLOSED — a wrong crest
// would be fabrication) to get each crest, then attribute each player to a
// nation via that nation's roster. National-team player names arrive from the
// odds feed in a DIFFERENT word order and hyphenation than ESPN uses
// (e.g. "Kangin Lee" vs ESPN "Lee Kang-In"), so plain normalizeName misses; we
// key the roster on a SORTED token set with hyphenated segments joined.
const WORLD_CUP_PATH = "soccer/fifa.world";
const nameTokenKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/-/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

type WcTeam = { id?: string | number; displayName?: string; name?: string; logos?: Array<{ href?: string }> };
type WcTeamsResp = { sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: WcTeam }> }> }> };
type WcTeamRef = { id: string; logo: string };

// Resolve one national team from ESPN's FIFA World Cup teams list by name.
// Layered match (exact → substring → 5-char prefix), each requiring a UNIQUE
// hit; anything ambiguous or missing a crest returns null (fail closed).
export async function resolveWorldCupTeam(name: string): Promise<WcTeamRef | null> {
  if (!name) return null;
  const data = await cachedJson<WcTeamsResp>(`wc-teams`, 24 * 60 * 60 * 1000, async () => {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${WORLD_CUP_PATH}/teams`);
    if (!r.ok) throw new Error(`ESPN WC teams ${r.status}`);
    return (await r.json()) as WcTeamsResp;
  }).catch(() => null);
  const teams = (data?.sports?.[0]?.leagues?.[0]?.teams ?? [])
    .map((t) => t.team)
    .filter((t): t is WcTeam => !!t);
  if (!teams.length) return null;
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const teamName = (t: WcTeam) => norm(t.displayName ?? t.name ?? "");
  const want = norm(name);
  const pick = (cands: WcTeam[]): WcTeamRef | null => {
    if (cands.length !== 1) return null;
    const t = cands[0];
    const logo = t.logos?.[0]?.href;
    if (t.id == null || !logo) return null;
    return { id: String(t.id), logo };
  };
  let r = pick(teams.filter((t) => teamName(t) === want));
  if (r) return r;
  r = pick(teams.filter((t) => { const n = teamName(t); return n.length > 0 && (n.includes(want) || want.includes(n)); }));
  if (r) return r;
  const p = want.slice(0, 5);
  r = pick(teams.filter((t) => { const n = teamName(t); return n.length >= 5 && (n.startsWith(p) || want.startsWith(n.slice(0, 5))); }));
  return r;
}

type WcRosterEntry = { headshot: string | null; athleteId: string | null; teamId: string; teamLogo: string };
async function fetchWorldCupRosterMap(team: WcTeamRef): Promise<Map<string, WcRosterEntry>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${WORLD_CUP_PATH}/teams/${team.id}/roster`;
  const data = await cachedJson<EspnRoster>(`wc-roster:${team.id}`, 6 * 60 * 60 * 1000, async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ESPN WC roster ${r.status}`);
    return (await r.json()) as EspnRoster;
  });
  const m = new Map<string, WcRosterEntry>();
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
    m.set(nameTokenKey(name), {
      headshot: href ?? null,
      athleteId: a.id != null ? String(a.id) : null,
      teamId: team.id,
      teamLogo: team.logo,
    });
  }
  return m;
}

router.get("/sports/props", async (req, res): Promise<void> => {
  const sport = String(req.query["sport"] || "").toLowerCase();
  const eventId = String(req.query["eventId"] || "");
  const homeTeamId = String(req.query["homeTeamId"] || "");
  const awayTeamId = String(req.query["awayTeamId"] || "");
  // Full team names (e.g. "Oklahoma City Thunder") — used to resolve the REAL
  // Odds API event id when the client's eventId came from a FALLBACK odds source
  // (ESPN scoreboard / Bovada). Those fallbacks fire when the primary Odds API
  // bulk-odds fetch is rate-limited, and they stamp the game with an ESPN/Bovada
  // id, NOT an Odds API id. Querying the Odds API per-event props endpoint with
  // that wrong id 404s → empty props → the chat AI honestly but wrongly reports
  // "no player props are up" even though the Odds API HAS props for the game.
  const homeName = String(req.query["home"] || "").trim();
  const awayName = String(req.query["away"] || "").trim();
  if (!sport || !eventId) {
    res.status(400).json({ error: "sport and eventId are required" });
    return;
  }
  const oddsKeyRaw = ODDS_SPORT_KEYS[sport];
  if (!oddsKeyRaw) {
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
    // The Odds API per-event props endpoint only accepts an Odds API event id
    // (32-char hex) under the event's OWN league key. Two things can be off:
    //   1. the eventId came from an ESPN/Bovada fallback source (wrong shape), or
    //   2. the sport is MULTI-KEY (soccer) and we don't yet know the league.
    // Both are resolved below from the free per-league events endpoint (0 quota),
    // which is cached 5 min so repeat lookups don't re-hit upstream.
    const looksLikeOddsApiId = /^[a-f0-9]{32}$/i.test(eventId);
    let effectiveEventId = eventId;

    // Shared helpers for resolving an Odds API event from a league's free,
    // 5-min-cached events list (0 quota credits).
    const fetchEvents = (key: string) =>
      cachedJson<Array<{ id: string; home_team: string; away_team: string }>>(
        `odds-events:${key}`,
        5 * 60 * 1000,
        async () => {
          const url = `https://api.the-odds-api.com/v4/sports/${key}/events?apiKey=${apiKey}&dateFormat=iso`;
          const r = await fetchOddsApi(url);
          if (!r.ok) throw new Error(`events ${r.status}`);
          return (await r.json()) as Array<{ id: string; home_team: string; away_team: string }>;
        },
      );
    // Prefer an EXACT Odds API id match (when the client already has a real one).
    // Otherwise prefer a FULL-name match (normalized alnum), then nickname (last
    // alpha word) ONLY when it uniquely identifies one event. Name comparisons
    // are orientation-agnostic (ESPN/Bovada home/away can be flipped vs the Odds
    // API). We FAIL CLOSED: an ambiguous nickname (collision sports — NCAAB/NCAAF
    // "Tigers", "Wildcats") resolves NOTHING rather than risk a DIFFERENT game's
    // props (fabrication). Empty props is the honest outcome.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nick = (s: string) => (s.toLowerCase().match(/[a-z]+/g) || []).pop() || "";
    const matchEvent = (
      events: Array<{ id: string; home_team: string; away_team: string }>,
    ): { id: string } | undefined => {
      if (looksLikeOddsApiId) {
        const byId = events.find((e) => e.id === eventId);
        if (byId) return byId;
      }
      if (!homeName || !awayName) return undefined;
      const wantHomeFull = norm(homeName);
      const wantAwayFull = norm(awayName);
      const fullMatches = events.filter((e) => {
        const eh = norm(e.home_team);
        const ea = norm(e.away_team);
        return (eh === wantHomeFull && ea === wantAwayFull) || (eh === wantAwayFull && ea === wantHomeFull);
      });
      if (fullMatches.length === 1) return fullMatches[0];
      if (fullMatches.length === 0) {
        const wantHomeNick = nick(homeName);
        const wantAwayNick = nick(awayName);
        const nickMatches = events.filter((e) => {
          const eh = nick(e.home_team);
          const ea = nick(e.away_team);
          return (eh === wantHomeNick && ea === wantAwayNick) || (eh === wantAwayNick && ea === wantHomeNick);
        });
        if (nickMatches.length === 1) return nickMatches[0];
      }
      return undefined;
    };

    let oddsKey: string;
    if (Array.isArray(oddsKeyRaw)) {
      // MULTI-KEY sport (soccer): the event lives in exactly ONE league, but the
      // client only says sport=soccer. The per-event props endpoint 404s under
      // the wrong league key, so locate the league whose events list claims this
      // event — by exact Odds API id when we have one, else by team name. FAIL
      // CLOSED to empty props if no league claims it (better than a wrong-game
      // 404). Lists are fetched in parallel; the array order decides ties.
      const lists = await Promise.all(
        oddsKeyRaw.map(async (key) => {
          try {
            return { key, events: await fetchEvents(key) };
          } catch {
            return { key, events: [] as Array<{ id: string; home_team: string; away_team: string }> };
          }
        }),
      );
      let resolvedKey: string | undefined;
      for (const { key, events } of lists) {
        const m = matchEvent(events);
        if (m) {
          resolvedKey = key;
          effectiveEventId = m.id;
          break;
        }
      }
      if (!resolvedKey) {
        req.log.warn(
          { sport, eventId, homeName, awayName },
          "multi-key league resolution failed; returning empty props",
        );
        res.json({ home: null, away: null, props: [] });
        return;
      }
      oddsKey = resolvedKey;
    } else {
      // SINGLE-KEY sport: the per-event endpoint only accepts an Odds API id. If
      // the client's eventId came from an ESPN/Bovada fallback source it's a
      // different shape and would 404, so resolve the real id by name when we can.
      oddsKey = oddsKeyRaw;
      if (!looksLikeOddsApiId && homeName && awayName) {
        try {
          const m = matchEvent(await fetchEvents(oddsKey));
          if (m?.id) effectiveEventId = m.id;
          else
            req.log.warn(
              { sport, homeName, awayName },
              "Odds API event-id resolution ambiguous/not-found; using client eventId (props may be empty)",
            );
        } catch (err) {
          req.log.warn({ err, sport, homeName, awayName }, "Odds API event-id resolution failed; using client eventId");
        }
      }
    }

    const fetchOdds = async (mkList: string[]) => {
      const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/events/${effectiveEventId}/odds?apiKey=${apiKey}&regions=us&markets=${mkList.join(",")}&oddsFormat=american`;
      const r = await fetchOddsApi(url);
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Upstream ${r.status}: ${text.slice(0, 200)}`);
      }
      return (await r.json()) as RawEventOdds;
    };

    const qhMarkets = QH_MARKETS_BY_SPORT[sport] ?? [];
    const altMarkets = ALT_MARKETS_BY_SPORT[sport] ?? [];
    const [data, qhData, altData] = await Promise.all([
      cachedJson<RawEventOdds>(`props:${oddsKey}:${effectiveEventId}`, 5 * 60 * 1000, () => fetchOdds(markets)),
      qhMarkets.length
        ? cachedJson<RawEventOdds | null>(`props-qh:${oddsKey}:${effectiveEventId}:v2`, 5 * 60 * 1000, async () => {
            // Honest fallback: if a quarter/half segment 422s for this sport/event
            // (e.g. game not in-window for QH lines yet) we return null and keep
            // the base props rather than failing the whole request.
            try { return await fetchOdds(qhMarkets); } catch { return null; }
          })
        : Promise.resolve(null),
      altMarkets.length
        ? cachedJson<RawEventOdds | null>(`props-alt:${oddsKey}:${effectiveEventId}:v1`, 5 * 60 * 1000, async () => {
            // Same honest fallback as QH: the alternate-ladder batch is all-or-
            // nothing on the Odds API, so a 422 (bad/unsupported key, game not in
            // window) returns null and the base + QH props stand on their own.
            try { return await fetchOdds(altMarkets); } catch { return null; }
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
    const americanToDecimal = (a: number) => (a > 0 ? a / 100 + 1 : 100 / -a + 1);
    const betterAmerican = (a: number, b: number) => (americanToProb(a) < americanToProb(b) ? a : b);
    type PropRow = {
      player: string;
      market: string;
      line: number | null;
      overPrice: number | null;
      underPrice: number | null;
      // The sportsbook behind the best price on each side (for "where to bet"
      // arbitrage). Tracked in lockstep with overPrice/underPrice below.
      overBook: string | null;
      underBook: string | null;
      alt: boolean;
      // Cross-book +EV / "mispriced" signal (MAIN lines only, computed below).
      // ev = expected value % of the best posted price vs the no-vig consensus
      // fair value across books; evSide = the side that carries that edge;
      // fairProb = consensus fair win prob (0-1) of that side; edge = fairProb -
      // best-price implied prob, in percentage points; books = # of two-sided
      // books used for the consensus. All null when coverage is too thin (honest).
      ev?: number | null;
      evSide?: "Over" | "Under" | null;
      fairProb?: number | null;
      edge?: number | null;
      books?: number;
      // Line-shopping spread (pct points) per side: median implied prob across
      // books MINUS the best (lowest) implied prob. Higher = more dispersion to
      // exploit. Needs >= 2 books posting that side; null otherwise (honest).
      overSpread?: number | null;
      underSpread?: number | null;
    };
    const byKey = new Map<string, PropRow>();
    // Per-book two-sided prices for MAIN lines, used to compute the no-vig
    // consensus fair value. Keyed the same as byKey (player|market|line), then by
    // book title → { over, under }. Only a book that posts BOTH sides can be
    // de-vigged, so we keep them per book and require a minimum count below.
    type SideBook = { over?: number; under?: number };
    const bookByKey = new Map<string, Map<string, SideBook>>();
    // Ingest a source's outcomes. Alternate-ladder sources strip the
    // "_alternate" suffix so each rung folds into the SAME (player, stat) bucket
    // as the main line; a rung that also exists as a real MAIN line is treated
    // as main (alt=false), never as an alt rung.
    const ingest = (src: RawEventOdds | null, isAlt: boolean) => {
      if (!src) return;
      for (const book of src.bookmakers ?? []) {
        for (const m of book.markets ?? []) {
          const marketKey = isAlt ? m.key.replace(/_alternate$/, "") : m.key;
          for (const o of m.outcomes ?? []) {
            const player = o.description ?? "—";
            const line = o.point ?? null;
            const k = `${player}|${marketKey}|${line ?? "_"}`;
            const row = byKey.get(k) ?? { player, market: marketKey, line, overPrice: null, underPrice: null, overBook: null, underBook: null, alt: isAlt };
            if (!isAlt) row.alt = false;
            const price = Math.round(o.price);
            const side = o.name.toLowerCase();
            const isOver = side === "over" || side === "yes";
            const isUnder = side === "under" || side === "no";
            const title = book.title ?? "?";
            // Keep the BEST price per side AND the book that posts it. A new book
            // wins the slot whenever betterAmerican prefers its price (ties go to
            // the newer book, matching betterAmerican's bias).
            if (isOver) {
              if (row.overPrice == null) { row.overPrice = price; row.overBook = title; }
              else { const b = betterAmerican(row.overPrice, price); if (b !== row.overPrice) { row.overPrice = b; row.overBook = title; } }
            } else if (isUnder) {
              if (row.underPrice == null) { row.underPrice = price; row.underBook = title; }
              else { const b = betterAmerican(row.underPrice, price); if (b !== row.underPrice) { row.underPrice = b; row.underBook = title; } }
            }
            byKey.set(k, row);
            // Record this book's posted price per side (MAIN lines only) so we can
            // de-vig each book individually and form a consensus fair value. Alt
            // rungs are excluded — they have sparse, lopsided coverage that would
            // produce an unreliable "fair" line.
            if (!isAlt && (isOver || isUnder)) {
              let bm = bookByKey.get(k);
              if (!bm) { bm = new Map(); bookByKey.set(k, bm); }
              const sb = bm.get(title) ?? {};
              if (isOver) sb.over = price; else sb.under = price;
              bm.set(title, sb);
            }
          }
        }
      }
    };
    // Mains first (so a shared line stays main), then alternate ladders.
    ingest(data, false);
    ingest(qhData, false);
    ingest(altData, true);

    // Trim alternate rungs: the raw ladder can run 3.5 → 49.5 with deep-ITM and
    // longshot rungs that would bloat the chat context + UI list (capped
    // downstream). Per (player, stat) keep only rungs within a sane bettable
    // price band and nearest the MAIN line — enough for a cushion rung and a
    // value rung on each side. Mains are always kept and emitted first so the
    // downstream slice caps drop alt rungs before any main line.
    const inBand = (p: number | null) => p != null && p >= -600 && p <= 600;
    const allRows = Array.from(byKey.values());
    const mainLineByPM = new Map<string, number>();
    for (const r of allRows) {
      if (!r.alt && r.line != null) {
        const pm = `${r.player}|${r.market}`;
        if (!mainLineByPM.has(pm)) mainLineByPM.set(pm, r.line);
      }
    }
    const mains = allRows.filter((r) => !r.alt);
    const altByPM = new Map<string, PropRow[]>();
    for (const r of allRows) {
      if (!r.alt) continue;
      if (!inBand(r.overPrice) && !inBand(r.underPrice)) continue;
      const pm = `${r.player}|${r.market}`;
      const list = altByPM.get(pm) ?? [];
      list.push(r);
      altByPM.set(pm, list);
    }
    const ALT_CAP_PER_PM = 6;
    const trimmedAlts: PropRow[] = [];
    for (const [pm, list] of altByPM) {
      const mainLine = mainLineByPM.get(pm);
      list.sort((a, b) => {
        const da = a.line != null ? Math.abs(a.line - (mainLine ?? 0)) : Infinity;
        const db = b.line != null ? Math.abs(b.line - (mainLine ?? 0)) : Infinity;
        return da - db;
      });
      for (const r of list.slice(0, ALT_CAP_PER_PM)) trimmedAlts.push(r);
    }
    const aggregatedRows = [...mains, ...trimmedAlts];

    // ---- Cross-book +EV ("mispriced prop") detection (MAIN lines only) -------
    // For each main line we de-vig EVERY book that posted BOTH sides
    // (fairOver = oImpl / (oImpl + uImpl)), take the MEDIAN across books as the
    // consensus fair win probability, then compare the BEST posted price on each
    // side to that fair value. EV% = fair * decimalOdds(best) - 1 (>0 means the
    // best price pays more than the consensus says it should = a value/+EV spot).
    // We require >= MIN_DEVIG_BOOKS two-sided books so a single off-market book
    // can't manufacture a phantom edge; thinner coverage stays unflagged (null),
    // never guessed. The outlier book is intentionally LEFT IN the consensus,
    // which only ever SHRINKS the measured edge — a deliberately conservative,
    // honesty-first choice (we'd rather understate value than invent it).
    const MIN_DEVIG_BOOKS = 3;
    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    for (const r of mains) {
      const k = `${r.player}|${r.market}|${r.line ?? "_"}`;
      const bm = bookByKey.get(k);
      if (!bm) continue;
      const fairOvers: number[] = [];
      const fairUnders: number[] = [];
      for (const sb of bm.values()) {
        if (sb.over == null || sb.under == null) continue;
        const oi = americanToProb(sb.over);
        const ui = americanToProb(sb.under);
        const tot = oi + ui;
        if (tot <= 0) continue;
        fairOvers.push(oi / tot);
        fairUnders.push(ui / tot);
      }
      if (fairOvers.length < MIN_DEVIG_BOOKS) continue;
      const fairOver = median(fairOvers);
      const fairUnder = median(fairUnders);
      const evOver = r.overPrice != null ? fairOver * americanToDecimal(r.overPrice) - 1 : -Infinity;
      const evUnder = r.underPrice != null ? fairUnder * americanToDecimal(r.underPrice) - 1 : -Infinity;
      if (evOver === -Infinity && evUnder === -Infinity) continue;
      const pickOver = evOver >= evUnder;
      const ev = pickOver ? evOver : evUnder;
      const fair = pickOver ? fairOver : fairUnder;
      const best = (pickOver ? r.overPrice : r.underPrice) as number;
      r.ev = Math.round(ev * 1000) / 10; // EV as a percentage, 1 decimal
      r.evSide = pickOver ? "Over" : "Under";
      r.fairProb = Math.round(fair * 1000) / 1000;
      r.edge = Math.round((fair - americanToProb(best)) * 1000) / 10; // pct points
      r.books = fairOvers.length;
    }

    // ---- Line-shopping spread per side (MAIN lines only) -------------------
    // Independent of the +EV de-vig (needs only 2+ books on a side): how much
    // the BEST price beats the cross-book median, in implied-prob pct points.
    // Lets a prop pick ground its line-shopping sub-score honestly; thin sides
    // stay null (never guessed).
    for (const r of mains) {
      const k = `${r.player}|${r.market}|${r.line ?? "_"}`;
      const bm = bookByKey.get(k);
      if (!bm) continue;
      const sideSpread = (pick: (sb: SideBook) => number | undefined): number | null => {
        const implied = [...bm.values()]
          .map(pick)
          .filter((p): p is number => p != null)
          .map((p) => americanToProb(p));
        if (implied.length < 2) return null;
        const best = Math.min(...implied);
        return Math.round((median(implied) - best) * 1000) / 10; // pct points
      };
      r.overSpread = sideSpread((sb) => sb.over);
      r.underSpread = sideSpread((sb) => sb.under);
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

    // World Cup soccer: attach the national-team crest (+ a real headshot when
    // ESPN has one) the only way the data allows — by resolving both nations
    // from their NAMES and attributing each player via roster. Fail-closed: any
    // player we can't confidently place keeps a null crest (client shows
    // initials) rather than guessing a flag.
    let wcMap: Map<string, WcRosterEntry> | null = null;
    if (sport === "soccer") {
      const [homeTeam, awayTeam] = await Promise.all([
        resolveWorldCupTeam(data.home_team ?? "").catch(() => null),
        resolveWorldCupTeam(data.away_team ?? "").catch(() => null),
      ]);
      const rosters = await Promise.all(
        [homeTeam, awayTeam]
          .filter((t): t is WcTeamRef => !!t)
          .map((t) => fetchWorldCupRosterMap(t).catch(() => new Map<string, WcRosterEntry>())),
      );
      if (rosters.length) {
        // Merge both rosters, but FAIL CLOSED on cross-nation name collisions:
        // if the same tokenized name appears on BOTH teams we can't tell which
        // player the prop means, so suppress the crest (initials) rather than
        // overwrite-and-guess.
        wcMap = new Map<string, WcRosterEntry>();
        const ambiguous = new Set<string>();
        for (const m of rosters) {
          for (const [k, v] of m) {
            if (ambiguous.has(k)) continue;
            const existing = wcMap.get(k);
            if (existing && existing.teamId !== v.teamId) {
              wcMap.delete(k);
              ambiguous.add(k);
              continue;
            }
            wcMap.set(k, v);
          }
        }
      }
    }

    const props = aggregatedRows.map((p) => {
      const r = rosterMap?.get(normalizeName(p.player));
      const w = wcMap?.get(nameTokenKey(p.player));
      return {
        ...p,
        headshot: w?.headshot ?? r?.headshot ?? null,
        athleteId: w?.athleteId ?? r?.athleteId ?? null,
        playerTeamId: w?.teamId ?? r?.teamId ?? null,
        teamLogo: w?.teamLogo ?? null,
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
// PrizePicks projection league ids — used ONLY as a last-resort fallback when
// the paid Odds API has no player props for an event. WNBA is intentionally
// omitted: its real props come through the Odds API (verified working), and we
// have no VERIFIED PrizePicks league id for it. Guessing one would silently
// fetch a different sport's projections — a fabrication the no-fake-data rule
// forbids — so WNBA simply has no PP fallback rather than a wrong one.
const PRIZEPICKS_LEAGUE_BY_SPORT: Record<string, number> = {
  nba: 7, nfl: 9, mlb: 2, nhl: 8, ncaaf: 15, ncaab: 20,
};

router.use("/sports/prizepicks-props", rateLimit({ windowMs: 60_000, max: 30, name: "prizepicks-props" }));

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
