import { fetch as expoFetch } from "expo/fetch";
import { oddsSatisfiesThreshold, type OddsThreshold } from "./format";

// The Express backend (artifacts/api-server) is reached through the Replit dev
// domain. EXPO_PUBLIC_DOMAIN is injected by the dev script.
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "/api";

// ---------- Types (mirror lib/api-spec/openapi.yaml) ----------

export type OddsBookPrice = { book: string; price: number; point?: number | null };

export type OddsOutcome = {
  name: string;
  price: number;
  point?: number | null;
  books?: OddsBookPrice[];
};

export type OddsMarket = { key: string; outcomes: OddsOutcome[] };

export type OddsGame = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: OddsMarket[];
};

export type EspnGame = {
  id: string;
  sport: string;
  name: string;
  shortName: string;
  status: string;
  startsAt: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
  venue?: string | null;
  clock?: string | null;
  period?: number | null;
  periodLabel?: string | null;
  state?: string | null;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

// A single real-odds context entry sent to the chat AI (matches the web app).
export type RealOddsEntry = {
  sport: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  startsAt?: string;
};

export type RealGameEntry = {
  sport: string;
  game: string;
  status?: string;
  startsAt?: string;
  venue?: string | null;
};

// ---------- Fetchers ----------

// Max time any single GET (odds / games / props) may take. On native, a dropped
// socket does NOT reliably reject an in-flight expo/fetch — the promise can hang
// forever. buildChatContext fan-outs already degrade gracefully on REJECTION
// (.catch → [] / try-catch → skip), but a silent hang would stall the whole
// Promise.all and freeze the "Building your parlay…" spinner BEFORE the chat
// stream is ever reached. So we race every request against a hard timeout that
// rejects, converting a hung link into the same graceful "narrower pool" path.
const REQUEST_TIMEOUT_MS = 12000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`request timeout: ${label}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await withTimeout(expoFetch(`${API_BASE}${path}`, { signal }), REQUEST_TIMEOUT_MS, path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await withTimeout(res.json() as Promise<T>, REQUEST_TIMEOUT_MS, `${path} (body)`));
}

// ---------- Authenticated requests (Clerk Bearer token) ----------

// On mobile there is no browser cookie jar, so the Clerk session token must be
// attached explicitly. The root layout registers a getter once the user's auth
// state is known; until then (or when signed out) it returns null and authed
// calls go out without a token (the server then replies 401).
type TokenGetter = () => Promise<string | null>;
let authTokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null): void {
  authTokenGetter = getter;
}

async function authedFetch(
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers ?? {}) };
  let token: string | null = null;
  try {
    token = authTokenGetter ? await authTokenGetter() : null;
  } catch {
    token = null;
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return expoFetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  }) as unknown as Promise<Response>;
}

// ---------- Cross-device sync (per signed-in user) ----------

// Whitelisted namespaces on the server (routes/sync.ts).
export type SyncNamespace = "savedSlips" | "tracker";

export type SyncResponse<T> = { data: T | null; updatedAt: string | null };

// Read the signed-in user's stored blob for a namespace. Throws on ANY non-2xx
// (including 401) so callers can distinguish a real, authenticated read — where
// `data: null` means the server is genuinely empty — from a not-ready token or
// transient failure. This prevents marking a session "synced" (and later
// overwriting server data with empty local state) before a successful pull.
export async function getSync<T>(
  namespace: SyncNamespace,
  signal?: AbortSignal,
): Promise<SyncResponse<T>> {
  const res = await authedFetch(`/sync/${namespace}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SyncResponse<T>;
}

// Persist the signed-in user's blob for a namespace. Throws on 401 so callers
// can tell the push didn't happen (e.g. token not ready yet).
export async function putSync<T>(
  namespace: SyncNamespace,
  data: T,
): Promise<void> {
  const res = await authedFetch(`/sync/${namespace}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function getOdds(sport: string, signal?: AbortSignal): Promise<OddsGame[]> {
  return getJson<OddsGame[]>(`/sports/odds?sport=${encodeURIComponent(sport)}`, signal);
}

export function getGames(sport: string, signal?: AbortSignal): Promise<EspnGame[]> {
  return getJson<EspnGame[]>(`/sports/games?sport=${encodeURIComponent(sport)}`, signal);
}

// ---------- Player props ----------

// A single bookmaker player-prop line (matches artifacts/api-server props.ts).
// line is null for yes/no markets (e.g. anytime TD); over/under may be null when
// only one side is posted. alt=true marks an alternate-ladder rung.
export type PlayerProp = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  alt: boolean;
  headshot: string | null;
  athleteId: string | null;
  playerTeamId: string | null;
};

export type PropsResponse = {
  home: string | null;
  away: string | null;
  bookmaker: string | null;
  props: PlayerProp[];
};

// Sports the props endpoint actually serves (MARKETS_BY_SPORT in props.ts).
// Soccer/tennis/ufc return [] upstream, so we don't offer them in the props UI.
export const PROPS_SPORTS = ["mlb", "wnba", "nba", "nhl", "nfl", "ncaaf", "ncaab"];

export type GetPropsArgs = {
  sport: string;
  eventId: string;
  home?: string;
  away?: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
};

// Per-event player props. Pass home/away names so the server can resolve the
// real Odds API event id when eventId came from a fallback odds source, and
// team ids so it can attach real ESPN headshots.
export function getProps(args: GetPropsArgs, signal?: AbortSignal): Promise<PropsResponse> {
  const q = new URLSearchParams({ sport: args.sport, eventId: args.eventId });
  if (args.home) q.set("home", args.home);
  if (args.away) q.set("away", args.away);
  if (args.homeTeamId) q.set("homeTeamId", args.homeTeamId);
  if (args.awayTeamId) q.set("awayTeamId", args.awayTeamId);
  return getJson<PropsResponse>(`/sports/props?${q.toString()}`, signal);
}

// ---------- Player history (real ESPN game logs + season stats) ----------

export type PlayerGameLogEntry = {
  eventId: string;
  date: string | null;
  opponentName: string | null;
  isHome: boolean | null;
  stats: Record<string, string>;
};

export type PlayerStatSummary = {
  games: number;
  averages: Record<string, number>;
  totals: Record<string, number>;
};

// A single ESPN search hit (artifacts/api-server /sports/player-search).
export type PlayerSearchResult = {
  athleteId: string;
  name: string;
  sport: string;
  league: string;
  team: string | null;
  headshot: string | null;
  isActive: boolean;
};

// Resolve a free-text name to real ESPN athletes (relevance-ranked).
export function searchPlayer(
  query: string,
  signal?: AbortSignal,
): Promise<{ query: string; results: PlayerSearchResult[] }> {
  return getJson(`/sports/player-search?query=${encodeURIComponent(query)}`, signal);
}

// Real per-game game log + season aggregates from ESPN (artifacts/api-server
// /sports/player-history). Everything here is a real recorded stat line — the
// server fabricates nothing and returns empty buckets when a feed has no data.
export type PlayerHistory = {
  sport: string;
  athleteId: string;
  labels: string[];
  recent: PlayerGameLogEntry[];
  vsOpponent: PlayerGameLogEntry[];
  vsOpponentName: string | null;
  season: string | null;
  availableSeasons: string[];
  seasonSummary: PlayerStatSummary;
};

export type GetPlayerHistoryArgs = {
  sport: string;
  athleteId: string;
  season?: string | null;
  opponentName?: string | null;
};

export function getPlayerHistory(
  args: GetPlayerHistoryArgs,
  signal?: AbortSignal,
): Promise<PlayerHistory> {
  const q = new URLSearchParams({ sport: args.sport, athleteId: args.athleteId });
  if (args.season) q.set("season", args.season);
  if (args.opponentName) q.set("opponentName", args.opponentName);
  return getJson<PlayerHistory>(`/sports/player-history?${q.toString()}`, signal);
}

// ---------- Team stats (real ESPN schedule form) ----------

// A single ESPN team-search hit (artifacts/api-server /sports/team-search).
export type TeamSearchResult = {
  teamId: string;
  name: string;
  location: string | null;
  abbrev: string | null;
  sport: string;
  league: string;
  logo: string | null;
};

// Last-N form pack for a team — every number derived from real ESPN final
// scores. Counting fields are null when a feed has no decided games.
export type TeamForm = {
  games: number;
  wins: number;
  losses: number;
  ptsFor: number | null;
  ptsAgainst: number | null;
  avgMargin: number | null;
};

// One real completed game from a team's schedule (newest first).
export type TeamRecentGame = {
  date: string;
  opp: string | null;
  home: boolean;
  pts: number | null;
  oppPts: number | null;
  won: boolean | null;
};

// Real team form + recent results (artifacts/api-server /sports/team-history).
// `season` is non-null only when we fell back to a prior season (off-season).
export type TeamHistory = {
  sport: string;
  teamId: string;
  teamName: string | null;
  season: string | null;
  last10: TeamForm;
  last5: TeamForm;
  homeSplit: TeamForm;
  awaySplit: TeamForm;
  streak: { type: "W" | "L"; count: number } | null;
  record: { games: number; wins: number; losses: number; winPct: number | null };
  recent: TeamRecentGame[];
  lastGameDate: string | null;
};

// Resolve a free-text team name ("Lakers", "the Eagles") to real ESPN teams.
export function searchTeam(
  query: string,
  signal?: AbortSignal,
): Promise<{ query: string; results: TeamSearchResult[] }> {
  return getJson(`/sports/team-search?query=${encodeURIComponent(query)}`, signal);
}

// Real form + recent results for one team. Server falls back to the prior
// season for off-season sports so the card always shows real, recent games.
export function getTeamHistory(
  sport: string,
  teamId: string,
  signal?: AbortSignal,
): Promise<TeamHistory> {
  const q = new URLSearchParams({ sport, teamId });
  return getJson<TeamHistory>(`/sports/team-history?${q.toString()}`, signal);
}

// ---------- StatMuse period game log (real per-game period splits) ----------

// One real per-game period row scraped from StatMuse's results grid.
export type StatMuseGameRow = {
  date: string;
  value: string;
  team: string;
  loc: string; // "@" | "vs" | ""
  opp: string;
};

export type StatMuseGameLog = {
  player: string | null;
  period: string | null;
  stat: string;
  count: number;
  rows: StatMuseGameRow[];
};

// Real game-by-game PERIOD breakdown (e.g. "first quarter points last 5
// games"). ESPN game logs only carry full-game totals, so these come from
// StatMuse's results grid — every value is real. Returns { rows: [] } on a miss.
export function getStatmuseGamelog(
  q: string,
  league?: string | null,
  signal?: AbortSignal,
): Promise<StatMuseGameLog> {
  const params = new URLSearchParams({ q });
  if (league) params.set("league", league);
  return getJson<StatMuseGameLog>(`/sports/statmuse-gamelog?${params.toString()}`, signal);
}

// Map a raw Odds API market key to a short human label. Handles the _q1 / _h1
// period suffixes (and _alternate, though the server already strips it).
const PROP_MARKET_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  player_rebounds_assists: "Reb+Ast",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_blocks_steals: "Blocks+Steals",
  player_turnovers: "Turnovers",
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
  player_anytime_td: "Anytime TD",
  player_goals: "Goals",
  player_shots_on_goal: "Shots on Goal",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_stolen_bases: "Stolen Bases",
  player_sacks: "Sacks",
  pitcher_strikeouts: "Strikeouts",
};

export function propMarketLabel(key: string): string {
  let k = key;
  let suffix = "";
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  if (k.endsWith("_q1")) {
    suffix = " (Q1)";
    k = k.slice(0, -3);
  } else if (k.endsWith("_h1")) {
    suffix = " (1H)";
    k = k.slice(0, -3);
  }
  const base =
    PROP_MARKET_LABELS[k] ??
    k.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ");
  return base + suffix;
}

// ---------- Pickability window ----------

// In progress (started up to 4h ago) OR tips off within the next 48h.
export function isPickable(startsAt?: string | null): boolean {
  if (!startsAt) return false;
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now - 4 * 3600_000 && t < now + 48 * 3600_000;
}

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// American odds -> implied win probability. Used to pick the single alt-ladder
// rung closest to even money for each side. -110 -> ~0.524, +150 -> 0.40.
const impliedProb = (american: number) =>
  american < 0 ? -american / (-american + 100) : 100 / (american + 100);

// Convert an OddsGame into real-odds PICK entries (main markets only — keeps the
// chat context compact). Same shape the web app sends as context.realOdds.
export function buildRealOdds(
  g: OddsGame,
  oddsThreshold?: OddsThreshold | null,
  includePeriods = false,
): RealOddsEntry[] {
  if (!g || !g.markets) return [];
  const out: RealOddsEntry[] = [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const base = { sport: g.sport, game, startsAt: g.commenceTime };
  const h2h = g.markets.find((m) => m.key === "h2h");
  const spreads = g.markets.find((m) => m.key === "spreads");
  const totals = g.markets.find((m) => m.key === "totals");
  // Under an odds-threshold ask ("-200 or less" / "+300 or more") the MAIN
  // markets must be filtered to the bound too — not just the alt ladders below.
  // Standard -110 spreads/totals and pick'em moneylines do NOT satisfy a heavy
  // bound; if we surface them anyway the model picks them, the client threshold
  // filter strips them (leaving a half-size ticket), AND they burn the realOdds
  // context cap so the actually-qualifying alt rungs get truncated out. Keeping
  // only qualifying outcomes leaves a clean, fully-eligible pool.
  const mainOk = (price: number | null | undefined) =>
    !oddsThreshold || oddsSatisfiesThreshold(price, oddsThreshold);
  if (h2h) {
    for (const o of h2h.outcomes || []) {
      if (!mainOk(o.price)) continue;
      out.push({ ...base, market: "Moneyline", pick: `${nickname(o.name)} ML`, odds: o.price });
    }
  }
  if (spreads) {
    for (const o of spreads.outcomes || []) {
      if (!mainOk(o.price)) continue;
      const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
      out.push({ ...base, market: "Spread", pick: `${nickname(o.name)}${pt}`, odds: o.price });
    }
  }
  if (totals) {
    for (const o of totals.outcomes || []) {
      if (!mainOk(o.price)) continue;
      const pt = o.point == null ? "" : ` ${o.point}`;
      out.push({ ...base, market: "Total", pick: `${o.name}${pt}`.trim(), odds: o.price });
    }
  }

  // Alternate ladders (alt spreads / alt totals) the server merged in per-event.
  // Surface ONE rung per side so the context stays lean. WHICH rung depends on
  // the request: by default the rung closest to even money (a usable cushion/
  // value line); but under an odds-threshold ask ("-300 or less" / "+300 or
  // more") the LEAST-EXTREME rung that satisfies the bound — because that's the
  // end of the ladder such a ticket is actually built from (buying points to a
  // heavy favorite, or selling them for a longer payout). Without this, an
  // even-money rung never qualifies and the threshold ticket starves. Skip a
  // rung equal to the main number (not really an alt) or priced so short
  // (<= -1000) it adds no equity. The AI prompt already documents the "Alt
  // Spread"/"Alt Total" labels; the slip parser resolves them via marketFamily
  // (Alt Spread -> spread) plus the exact alt point.
  const ALT_MAX_JUICE = -1000;
  // Lower is "better": distance to the bound under a threshold, else distance
  // from even money.
  const rungCost = (o: OddsOutcome) =>
    oddsThreshold ? Math.abs(o.price - oddsThreshold.signed) : Math.abs(impliedProb(o.price) - 0.5);
  const bestRungPerSide = (
    outcomes: OddsOutcome[],
    sideKey: (o: OddsOutcome) => string,
    mainPts: Set<string>,
    ptKey: (o: OddsOutcome) => string,
  ): OddsOutcome[] => {
    const bySide = new Map<string, OddsOutcome>();
    for (const o of outcomes || []) {
      if (o.price == null || o.price <= ALT_MAX_JUICE) continue;
      if (mainPts.has(ptKey(o))) continue; // same number as the main line
      // Under a threshold, only rungs that actually satisfy the bound are useful.
      if (oddsThreshold && !oddsSatisfiesThreshold(o.price, oddsThreshold)) continue;
      const sk = sideKey(o);
      const cur = bySide.get(sk);
      if (!cur || rungCost(o) < rungCost(cur)) bySide.set(sk, o);
    }
    return [...bySide.values()];
  };
  const altSpreads = g.markets.find((m) => m.key === "alternate_spreads");
  const altTotals = g.markets.find((m) => m.key === "alternate_totals");
  if (altSpreads) {
    const mainPts = new Set((spreads?.outcomes ?? []).map((o) => `${nickname(o.name)}|${o.point ?? ""}`));
    for (const o of bestRungPerSide(altSpreads.outcomes || [], (o) => nickname(o.name), mainPts, (o) => `${nickname(o.name)}|${o.point ?? ""}`)) {
      const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
      out.push({ ...base, market: "Alt Spread", pick: `${nickname(o.name)}${pt}`, odds: o.price });
    }
  }
  if (altTotals) {
    const mainPts = new Set((totals?.outcomes ?? []).map((o) => `${o.name}|${o.point ?? ""}`));
    for (const o of bestRungPerSide(altTotals.outcomes || [], (o) => o.name, mainPts, (o) => `${o.name}|${o.point ?? ""}`)) {
      const pt = o.point == null ? "" : ` ${o.point}`;
      out.push({ ...base, market: "Alt Total", pick: `${o.name}${pt}`.trim(), odds: o.price });
    }
  }

  // Game-level PERIOD markets (1H/2H/Q1–Q4) the server merged in per-event. Only
  // emitted when the user asks for a period/same-game ticket (includePeriods), so
  // the default multi-game context stays lean. Friendly labels match the shared
  // chat SYSTEM_PROMPT ("1H Spread", "Q3 Total", "Q2 Moneyline", "1H Alt Spread",
  // "1H Alt Total") — the slip parser's marketFamily keeps each period distinct
  // so a "Q3 Moneyline" pick can't resolve to the full-game moneyline.
  if (includePeriods) {
    const PERIOD_LABEL: Record<string, string> = {
      h1: "1H", h2: "2H", q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4",
    };
    for (const [suffix, plabel] of Object.entries(PERIOD_LABEL)) {
      const pml = g.markets.find((m) => m.key === `h2h_${suffix}`);
      const psp = g.markets.find((m) => m.key === `spreads_${suffix}`);
      const ptot = g.markets.find((m) => m.key === `totals_${suffix}`);
      if (pml) {
        for (const o of pml.outcomes || []) {
          if (o.price == null || !mainOk(o.price)) continue;
          out.push({ ...base, market: `${plabel} Moneyline`, pick: `${nickname(o.name)} ML`, odds: o.price });
        }
      }
      if (psp) {
        for (const o of psp.outcomes || []) {
          if (o.price == null || !mainOk(o.price)) continue;
          const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
          out.push({ ...base, market: `${plabel} Spread`, pick: `${nickname(o.name)}${pt}`, odds: o.price });
        }
      }
      if (ptot) {
        for (const o of ptot.outcomes || []) {
          if (o.price == null || !mainOk(o.price)) continue;
          const pt = o.point == null ? "" : ` ${o.point}`;
          out.push({ ...base, market: `${plabel} Total`, pick: `${o.name}${pt}`.trim(), odds: o.price });
        }
      }
    }
    // First-half alternate ladders (only 1H alts are posted by the feed). One
    // rung per side, threshold-aware via bestRungPerSide (same as full-game alts).
    const altSpreadH1 = g.markets.find((m) => m.key === "alternate_spreads_h1");
    const altTotalH1 = g.markets.find((m) => m.key === "alternate_totals_h1");
    if (altSpreadH1) {
      const mainPts = new Set(
        (g.markets.find((m) => m.key === "spreads_h1")?.outcomes ?? []).map((o) => `${nickname(o.name)}|${o.point ?? ""}`),
      );
      for (const o of bestRungPerSide(altSpreadH1.outcomes || [], (o) => nickname(o.name), mainPts, (o) => `${nickname(o.name)}|${o.point ?? ""}`)) {
        const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
        out.push({ ...base, market: "1H Alt Spread", pick: `${nickname(o.name)}${pt}`, odds: o.price });
      }
    }
    if (altTotalH1) {
      const mainPts = new Set(
        (g.markets.find((m) => m.key === "totals_h1")?.outcomes ?? []).map((o) => `${o.name}|${o.point ?? ""}`),
      );
      for (const o of bestRungPerSide(altTotalH1.outcomes || [], (o) => o.name, mainPts, (o) => `${o.name}|${o.point ?? ""}`)) {
        const pt = o.point == null ? "" : ` ${o.point}`;
        out.push({ ...base, market: "1H Alt Total", pick: `${o.name}${pt}`.trim(), odds: o.price });
      }
    }
  }
  return out;
}

// ---------- Player-prop chat context ----------

// A real player-prop line sent to the chat AI (matches the web app's
// context.realProps shape). `market` is the RAW Odds API key so the prompt's
// stat-mapping (player_points→PTS, pitcher_strikeouts→SO, …) works.
export type RealPropEntry = {
  sport: string;
  game: string;
  startsAt: string;
  player: string;
  market: string;
  line: number | null;
  over: number | null;
  under: number | null;
  alt: boolean;
};

// Resolution-shape prop entry (one row per posted side) that the slip parser
// matches AI prop PICK lines against. Built client-side from realProps — never
// sent to the API.
export type PropPoolEntry = {
  sport?: string;
  game: string;
  marketLabel: string;
  player: string;
  line: number | null;
  side: "Over" | "Under";
  odds: number;
  // Render-only metadata (real ESPN data, never sent to the AI). headshot is the
  // player photo; teamAbbr is the player's team code resolved via playerTeamId.
  headshot?: string | null;
  teamAbbr?: string | null;
};

// Render-only team metadata for game-level picks (logos + abbreviations). Built
// from ESPN games, keyed by the "Away @ Home" game string. NEVER sent to the AI
// — it's used by the card renderer to show the picked team's logo + code.
export type GameMeta = {
  game: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string | null;
  awayAbbr: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
};

// Build the per-game render-only logo/abbr table from ESPN games. Exported so
// any screen holding stored picks (e.g. the Bet Slip's pinned AI cards) can
// re-resolve team logos/codes from a fresh games fetch — the in-memory aiPicks
// store can predate a parser change, so render-time enrichment keeps cards
// correct without a regeneration. Real ESPN data only; never sent to the AI.
export function buildGameMeta(games: EspnGame[]): GameMeta[] {
  const out: GameMeta[] = [];
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    out.push({
      game: `${away} @ ${home}`,
      homeTeam: home,
      awayTeam: away,
      homeAbbr: g.homeAbbr ?? null,
      awayAbbr: g.awayAbbr ?? null,
      homeLogo: g.homeLogo ?? null,
      awayLogo: g.awayLogo ?? null,
    });
  }
  return out;
}

type PropTeamIds = { homeTeamId: string | null; awayTeamId: string | null };

function buildPropIdMap(games: EspnGame[]): Map<string, PropTeamIds> {
  const map = new Map<string, PropTeamIds>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    map.set(`${nickname(away)}|${nickname(home)}`.toLowerCase(), {
      homeTeamId: g.homeTeamId ?? null,
      awayTeamId: g.awayTeamId ?? null,
    });
  }
  return map;
}

// How many of the soonest prop-capable games to pull props for when assembling
// chat context. Each game is a SEPARATE live Odds API request fired every chat
// turn, and the chat can't respond until all of them resolve — so this is a
// latency + rate-limit ceiling (props route allows 120/min, caches 5min), not a
// quality limit. 24 comfortably covers a full single-sport slate (MLB tops out
// ~15) plus multi-sport spillover, so on any realistic night this IS "all games";
// it only trims the tail on an unusually huge multi-sport board, taking the
// soonest games first. Going fully unbounded would risk throttling, which
// silently DROPS games and makes the pool thinner — the opposite of the goal.
const MAX_PROP_CONTEXT_GAMES = 24;
// Cap on prop rows the AI sees. MLB games each post 100+ rows, so a small cap
// taken in fetch-completion order would be filled by the first 2-3 games that
// resolve — leaving the AI blind to every other game's players (it would report
// "props concentrated in a few games"). We raise the cap AND select breadth-first
// across games (see balancePropsByGame) so every game is represented.
const MAX_PROPS_IN_CONTEXT = 400;

// Pick up to `cap` props spread evenly across games instead of taking the first
// `cap` in arrival order. Round-robins one prop per game per pass so a 12-game
// slate contributes ~equally and no game is starved by another's deep prop list.
function balancePropsByGame(props: RealPropEntry[], cap: number): RealPropEntry[] {
  if (props.length <= cap) return props;
  const byGame = new Map<string, RealPropEntry[]>();
  for (const p of props) {
    const arr = byGame.get(p.game);
    if (arr) arr.push(p);
    else byGame.set(p.game, [p]);
  }
  const buckets = [...byGame.values()];
  const out: RealPropEntry[] = [];
  for (let i = 0; out.length < cap; i++) {
    let pushedAny = false;
    for (const b of buckets) {
      if (i < b.length) {
        out.push(b[i]);
        pushedAny = true;
        if (out.length >= cap) break;
      }
    }
    if (!pushedAny) break; // all buckets exhausted
  }
  return out;
}

export type ChatContext = {
  selectedSports: string[];
  currentSlip: { game: string; market: string; pick: string; odds: number }[];
  realGames: RealGameEntry[];
  realOdds: RealOddsEntry[];
  realProps: RealPropEntry[];
};

// The lean real-data context sent to the AI, PLUS render-only metadata (player
// headshots, team logos/abbrs) the card renderer uses. The metadata is returned
// separately so it never bloats the AI request body (streamChat sends `context`
// only) yet the slip/coach can still show real photos + logos on each pick.
export type BuiltChatContext = {
  context: ChatContext;
  propPool: PropPoolEntry[];
  gameMeta: GameMeta[];
};

// Fetch live odds + games across the selected sports and assemble the real-data
// context the chat AI requires so it never fabricates fixtures or prices.
export async function buildChatContext(
  sports: string[],
  currentSlip: { game: string; market: string; pick: string; odds: number }[],
  signal?: AbortSignal,
  oddsThreshold?: OddsThreshold | null,
  includePeriods = false,
): Promise<BuiltChatContext> {
  // Keep the two feed types in separately-typed arrays so handling stays
  // type-safe; resilient per-sport (a failed fetch just yields an empty list).
  const [oddsAll, gamesAll] = await Promise.all([
    Promise.all(sports.map((s) => getOdds(s, signal).catch(() => [] as OddsGame[]))),
    Promise.all(sports.map((s) => getGames(s, signal).catch(() => [] as EspnGame[]))),
  ]);

  const realOdds: RealOddsEntry[] = [];
  const realGames: RealGameEntry[] = [];

  // Render-only team metadata: teamId -> {abbr, logo} (for resolving a prop
  // player's team via playerTeamId) and a per-game logo/abbr table (for
  // game-level picks). Real ESPN data only; never sent to the AI.
  const teamMetaById = new Map<string, { abbr: string | null; logo: string | null }>();
  for (const list of gamesAll) {
    for (const g of list) {
      if (g.homeTeamId) {
        teamMetaById.set(g.homeTeamId, { abbr: g.homeAbbr ?? null, logo: g.homeLogo ?? null });
      }
      if (g.awayTeamId) {
        teamMetaById.set(g.awayTeamId, { abbr: g.awayAbbr ?? null, logo: g.awayLogo ?? null });
      }
    }
  }
  const gameMeta = buildGameMeta(gamesAll.flat());

  sports.forEach((sport, i) => {
    for (const g of oddsAll[i]) {
      if (!isPickable(g.commenceTime)) continue;
      realOdds.push(...buildRealOdds(g, oddsThreshold, includePeriods));
    }
    for (const g of gamesAll[i]) {
      if (g.state === "post") continue; // finished
      if (!isPickable(g.startsAt)) continue;
      const away = g.awayTeam || g.awayAbbr || "";
      const home = g.homeTeam || g.homeAbbr || "";
      if (!away || !home) continue;
      realGames.push({
        sport,
        game: `${away} @ ${home}`,
        status: g.status,
        startsAt: g.startsAt,
        venue: g.venue ?? null,
      });
    }
  });

  // Assemble a REAL player-prop pool from the soonest prop-capable games so the
  // AI can build prop legs (and never fabricate them). PROPS_SPORTS only — the
  // props route returns nothing for soccer/tennis/ufc. A failed per-game fetch
  // just narrows the pool; it never invents props.
  const propCandidates: { sport: string; g: OddsGame; ids: PropTeamIds | null }[] = [];
  sports.forEach((sport, i) => {
    if (!PROPS_SPORTS.includes(sport)) return;
    const idMap = buildPropIdMap(gamesAll[i]);
    for (const g of oddsAll[i]) {
      if (!isPickable(g.commenceTime)) continue;
      if (!g.homeTeam || !g.awayTeam) continue;
      const ids = idMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()) ?? null;
      propCandidates.push({ sport, g, ids });
    }
  });
  propCandidates.sort((a, b) => Date.parse(a.g.commenceTime) - Date.parse(b.g.commenceTime));

  const realProps: RealPropEntry[] = [];
  // Render-only prop pool (one row per posted side) enriched with the real ESPN
  // headshot + team code. Built here from the raw PlayerProp because the
  // headshot/playerTeamId live on it and are stripped from the lean
  // RealPropEntry we send to the AI.
  const propPool: PropPoolEntry[] = [];
  await Promise.all(
    propCandidates.slice(0, MAX_PROP_CONTEXT_GAMES).map(async ({ sport, g, ids }) => {
      try {
        const r = await getProps(
          {
            sport,
            eventId: g.id,
            home: g.homeTeam,
            away: g.awayTeam,
            homeTeamId: ids?.homeTeamId,
            awayTeamId: ids?.awayTeamId,
          },
          signal,
        );
        const game = `${g.awayTeam} @ ${g.homeTeam}`;
        const usable = (r.props ?? []).filter((p) => p.overPrice != null || p.underPrice != null);
        // Two passes so MAIN lines are pushed before ALT ladder rungs: the
        // breadth-balanced context cap (balancePropsByGame) keeps the earlier
        // rows, so mains must come first. Alt rungs are real bookmaker ladder
        // values for the SAME player+stat — added as cushion/value options but
        // capped per player+market so one star's deep ladder can't crowd the pool.
        const altRungs = new Map<string, number>();
        const ALT_RUNGS_PER_PROP = 3;
        for (const altPass of [false, true]) {
          for (const p of usable) {
            if (!!p.alt !== altPass) continue;
            // Under an odds-threshold ask, keep only prop SIDES (MAIN or alt)
            // whose posted price satisfies the bound. Standard -110/-120 main
            // props don't meet a heavy bound, so surfacing them just lets the
            // model pick a leg the client threshold filter then strips — leaving
            // a half-size ticket. Gate at side granularity so the model never
            // even sees the non-qualifying side. With no threshold both sides
            // pass (no-op).
            const overQ = p.overPrice != null && (!oddsThreshold || oddsSatisfiesThreshold(p.overPrice, oddsThreshold));
            const underQ = p.underPrice != null && (!oddsThreshold || oddsSatisfiesThreshold(p.underPrice, oddsThreshold));
            if (oddsThreshold && !overQ && !underQ) continue;
            if (p.alt) {
              const k = `${p.player}|${p.market}`.toLowerCase();
              const n = altRungs.get(k) ?? 0;
              if (n >= ALT_RUNGS_PER_PROP) continue;
              altRungs.set(k, n + 1);
            }
            realProps.push({
              sport,
              game,
              startsAt: g.commenceTime,
              player: p.player,
              market: p.market,
              line: p.line,
              over: overQ ? p.overPrice : null,
              under: underQ ? p.underPrice : null,
              alt: !!p.alt,
            });
            const headshot = p.headshot ?? null;
            const teamAbbr = p.playerTeamId
              ? (teamMetaById.get(p.playerTeamId)?.abbr ?? null)
              : null;
            const marketLabel = propMarketLabel(p.market);
            if (overQ) {
              propPool.push({ sport, game, marketLabel, player: p.player, line: p.line, side: "Over", odds: p.overPrice!, headshot, teamAbbr });
            }
            if (p.line != null && underQ) {
              propPool.push({ sport, game, marketLabel, player: p.player, line: p.line, side: "Under", odds: p.underPrice!, headshot, teamAbbr });
            }
          }
        }
      } catch {
        // skip this game's props — narrower pool, never fabricated
      }
    }),
  );

  return {
    context: {
      selectedSports: sports,
      currentSlip,
      realGames: realGames.slice(0, 60),
      realOdds: realOdds.slice(0, 120),
      realProps: balancePropsByGame(realProps, MAX_PROPS_IN_CONTEXT),
    },
    propPool,
    gameMeta,
  };
}

// ---------- Chat streaming (SSE over POST) ----------

export type StreamChatArgs = {
  messages: ChatMessage[];
  context: ChatContext;
  onToken: (full: string) => void;
  signal?: AbortSignal;
};

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

// Streams the assistant reply token-by-token. Uses expo/fetch so getReader()
// works on native. Returns the full text once the stream closes.
//
// RESILIENCE: the parlay build holds an SSE connection open for ~10-15s while
// gpt-5.4 reasons. Through the Replit proxy that connection is sometimes dropped
// a couple of seconds in (before the first real token), and expo/fetch's reader
// then HANGS forever instead of rejecting — so the UI was stuck on "Building
// your parlay…" with no way out. We defend with two mechanisms:
//   1. A per-attempt stall watchdog. The server emits a keep-alive every ~3s of
//      silence, so if NOTHING arrives for STALL_MS the connection is dead — we
//      actively abort this attempt (which makes the hung reader reject).
//   2. Auto-retry. The drop is intermittent and happens before any content has
//      streamed, so re-POSTing is safe (no duplicated output) and usually
//      succeeds on a later attempt. Once real tokens have started we never retry
//      (that would duplicate text); and a real caller abort (unmount / user
//      cancel) propagates immediately and is never retried.
export async function streamChat({ messages, context, onToken, signal }: StreamChatArgs): Promise<string> {
  const STALL_MS = 4000; // max gap between chunks before we call the link dead
  const CONNECT_MS = 8000; // max wait for response HEADERS before we call it dead
  const MAX_ATTEMPTS = 4;

  let lastErr: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError();

    // Per-attempt controller so a stall can kill THIS attempt without tearing
    // down the caller's signal. Chained to the external signal so a genuine
    // unmount / user cancel still aborts everything and stops retries.
    const attemptCtrl = new AbortController();
    const onExternalAbort = () => attemptCtrl.abort();
    if (signal) signal.addEventListener("abort", onExternalAbort, { once: true });

    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    };

    let fullText = "";
    let sawContent = false;

    // Shared "deadline reached" sentinel for both the connect race (waiting for
    // response headers) and the per-chunk read race below.
    const STALL = Symbol("stall");

    try {
      // The fetch promise resolves once response HEADERS arrive. On native a
      // dead link can hang this promise too (not just reader.read()), so we race
      // it against a connect deadline. On timeout we abort the attempt (freeing
      // the socket) and fall through to the retry logic — same recovery path as a
      // mid-stream stall, and safe because no tokens have streamed yet.
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      const connectStall = new Promise<typeof STALL>((resolve) => {
        connectTimer = setTimeout(() => resolve(STALL), CONNECT_MS);
      });
      let res: Response | typeof STALL;
      try {
        res = await Promise.race([
          expoFetch(`${API_BASE}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, context }),
            signal: attemptCtrl.signal,
          }) as unknown as Promise<Response>,
          connectStall,
        ]);
      } finally {
        if (connectTimer) clearTimeout(connectTimer);
      }
      if (res === STALL) {
        attemptCtrl.abort(); // free the socket; do NOT await the orphaned fetch
        throw new Error("connect stalled");
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // CRITICAL: on native, expo/fetch does NOT reliably reject reader.read()
      // when the underlying socket is torn down — the promise just HANGS FOREVER.
      // That is exactly what left the UI stuck on "Building your parlay…" with no
      // recovery (the server logged "request aborted" while the client's await
      // never settled). So we NEVER `await reader.read()` directly: we race it
      // against a stall timer. If no chunk (a real token OR a server keep-alive
      // ping) arrives within STALL_MS the link is dead — we abort to free the
      // socket and bail to the retry logic WITHOUT waiting on the (possibly hung)
      // read. The server pings ~every 400ms even while the reasoning model is
      // silent before its first token, so a multi-second gap unambiguously means
      // a dropped connection, never a healthy slow start.
      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const stall = new Promise<typeof STALL>((resolve) => {
          stallTimer = setTimeout(() => resolve(STALL), STALL_MS);
        });
        let result: Awaited<ReturnType<typeof reader.read>> | typeof STALL;
        try {
          result = await Promise.race([reader.read(), stall]);
        } finally {
          if (stallTimer) clearTimeout(stallTimer);
        }
        if (result === STALL) {
          attemptCtrl.abort(); // free the socket; do NOT await the orphaned read
          throw new Error("stream stalled");
        }
        const { done, value } = result;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(chunk.slice(6));
            if (data.content) {
              fullText += data.content;
              sawContent = true;
              onToken(fullText);
            }
          } catch {
            // ignore keep-alive / status / ping frames
          }
        }
      }
      cleanup();
      return fullText;
    } catch (err) {
      cleanup();
      // A real caller abort (unmount / user cancel) wins — never retry.
      if (signal?.aborted) throw abortError();
      // Tokens already streamed → retrying would duplicate the reply. Propagate.
      if (sawContent) throw err;
      // Otherwise the link dropped/stalled before the first token: retry.
      lastErr = err;
    }
  }

  throw lastErr ?? new Error("chat stream failed");
}
