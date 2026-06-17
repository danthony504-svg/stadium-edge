import { fetch as expoFetch } from "expo/fetch";
import { oddsSatisfiesThreshold, type OddsThreshold } from "./format";
import { NAME_FALLBACK_SKIP } from "./statLookup";
import {
  contextDepthForLegs,
  focalSportsFromText,
  gameMatchesFocalText,
  prioritizePlayerHistoryTargets,
} from "./chatContextPriority";
import { buildGameInjuryReport, type GameInjuryReport } from "./injuries";
import { slipPropPlayerName } from "./slipPlayer";
import {
  isPickable,
  isPregameBettable,
  startsTodayUpcoming,
  wantsTodayOnly,
  resolveTodayOnly,
  todayBuildNote,
  mentionsPropIntent,
} from "./slate";

// Re-exported so existing callers (e.g. coach.tsx) keep importing it from ./api.
export { gameMatchesFocalText };
// Pure slate/pickability helpers (defined in ./slate); re-exported so the many
// existing `from "./api"` imports keep working unchanged.
export {
  isPickable,
  isPregameBettable,
  startsTodayUpcoming,
  wantsTodayOnly,
  resolveTodayOnly,
  todayBuildNote,
  mentionsPropIntent,
};

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
  // Cross-book no-vig + line-shopping signals (two-sided MAIN markets only;
  // null otherwise — never guessed). Computed server-side. noVigFair = median
  // consensus fair win prob (0-1); edge = noVigFair minus the best price's
  // implied prob (pct points, signed toward value); bookSpread = how much the
  // best price beats the cross-book median (pct points).
  noVigFair?: number | null;
  edge?: number | null;
  bookSpread?: number | null;
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
  // Real cross-book scoring inputs carried from the picked outcome (two-sided
  // MAIN markets only; null otherwise — never fabricated). Used to ground the
  // pick rubric's Line Value (edge) and Line-Shopping (bookSpread) sub-scores.
  noVigFair?: number | null;
  edge?: number | null;
  bookSpread?: number | null;
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

// Brief backoff between retries (grows with the attempt, plus jitter so a burst
// of clients doesn't retry in lockstep and re-trip a shared rate limiter).
function sleepBackoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 300 * attempt + Math.random() * 250));
}

// Resilient GET. A single transient blip used to nuke whole surfaces (e.g. the
// Props page errors out the moment its uncaught odds fetch fails). The most
// common transients are a 429 from the shared-proxy-IP rate limiter (every
// mobile client looks like one IP to the edge) and brief upstream 5xx — both
// return fast, so we retry those up to MAX_ATTEMPTS. Deterministic 4xx
// (400/401/404) won't change on retry, so we fail fast. Network drops/timeouts
// each wait the full per-request timeout, so we cap THOSE at a single retry to
// avoid stacking long stalls onto the chat-context fan-outs that share this
// fetcher (they have no shared deadline).
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let networkRetried = false;
  let lastErr: unknown = new Error(`request failed: ${path}`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error(`aborted: ${path}`);
    try {
      const res = await withTimeout(expoFetch(`${API_BASE}${path}`, { signal }), REQUEST_TIMEOUT_MS, path);
      if (res.ok) {
        return await withTimeout(res.json() as Promise<T>, REQUEST_TIMEOUT_MS, `${path} (body)`);
      }
      // Only 429 (rate limit) and 5xx (server/upstream blip) are transient.
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}`);
      lastErr = new Error(`HTTP ${res.status}`);
      if (attempt < MAX_ATTEMPTS) await sleepBackoff(attempt);
    } catch (e) {
      // A genuine caller abort (unmount / cancel) must never be retried.
      if (signal?.aborted) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // A deterministic HTTP error we threw above (any non-429/5xx) → propagate.
      if (/^HTTP (?!429|5\d\d)/.test(msg)) throw e;
      lastErr = e;
      // Network drop / timeout (no "HTTP " prefix): retry at most once.
      if (!/^HTTP /.test(msg)) {
        if (networkRetried) throw e;
        networkRetried = true;
      }
      if (attempt < MAX_ATTEMPTS) await sleepBackoff(attempt);
    }
  }
  throw lastErr;
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

// Whitelisted namespaces on the server (routes/sync.ts). "coachBuild" is
// written server-side (a parlay finished in the background after the user left)
// and only READ here on return — never PUT from the client.
export type SyncNamespace = "savedSlips" | "tracker" | "results" | "coachBuild";

// A parlay build the server finished after the phone disconnected. Stashed
// under the signed-in user's account so the app can rebuild the exact same pick
// cards on return (no fabrication — `full` is the model's verbatim reply and
// `props` is the exact resolved prop pool it was fed).
//
// `status` is the terminal outcome the server recorded:
//   - "ready"    → a complete reply is present (`full`/`props` populated)
//   - "timedOut" → the background watchdog aborted a stalled model (no picks)
//   - "failed"   → the stream errored / produced nothing usable (no picks)
// On a failed/timedOut stash we deliberately carry NO picks (honesty: a
// half-finished ticket is never delivered) — the client shows a retry instead.
// `status` is absent on older stashes written before this field existed; treat
// missing-but-has-`full` as "ready".
export type CoachBuildStash = {
  buildId: string;
  status?: "ready" | "timedOut" | "failed";
  full: string;
  props: RealPropEntry[];
  createdAt: string;
};

// ---------- Bet grading (routes/grade.ts) ----------

export type GradeOutcome = "win" | "loss" | "push" | "ungraded";

export type GradeLegInput = {
  game: string;
  market: string;
  pick: string;
  sport?: string;
  odds?: number;
  startsAt?: string;
};

export type GradeLegResult = {
  index: number;
  family: string;
  side: string;
  result: GradeOutcome;
  detail: string;
};

// Grade finished legs against REAL outcomes (final scores / real stat logs).
// Server fail-closes to "ungraded" for anything it can't settle for certain —
// we never invent a W/L. Returns results aligned to the input order by index.
export async function gradeBets(
  legs: GradeLegInput[],
  signal?: AbortSignal,
): Promise<GradeLegResult[]> {
  const path = "/sports/grade";
  const res = await withTimeout(
    expoFetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legs }),
      signal,
    }),
    REQUEST_TIMEOUT_MS,
    path,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await withTimeout(
    res.json() as Promise<{ results?: GradeLegResult[] }>,
    REQUEST_TIMEOUT_MS,
    `${path} (body)`,
  ));
  return Array.isArray(json.results) ? json.results : [];
}

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

// ---------- Account deletion (Clerk-authed; routes/account.ts) ----------

// Permanently delete the signed-in user's account and ALL associated data: the
// auth identity (including linked Google / Apple / password logins) plus saved
// slips, pick tracker, results, preferences and push tokens. Throws on any
// non-2xx so the caller keeps the user signed in and shows an error instead of
// a false success.
export async function deleteAccount(): Promise<void> {
  const res = await authedFetch(`/account`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ---------- Push notifications (Clerk-authed; routes/notifications.ts) ----------

// Per-user notification preferences. All default true; when `master` is false
// the server sends nothing regardless of the category flags.
export type NotifPrefs = {
  master: boolean;
  dailyPicks: boolean;
  betResults: boolean;
  oddsMovement: boolean;
  gameReminders: boolean;
  upsetAlerts: boolean;
  // Daily "Edge Lock" alert: real guaranteed arbitrage + +EV value bets found on
  // today's near-term board (taps through to the Edge Lock screen).
  edgeLockAlerts: boolean;
  // "Your AI Coach finished a parlay you walked away from." Sent from the /chat
  // background-finish path (not the cron jobs).
  coachReady: boolean;
};

// Register this device's Expo push token with the signed-in user's account.
export async function registerPushToken(token: string, platform?: string): Promise<void> {
  const res = await authedFetch("/notifications/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Remove this device's Expo push token from the account (e.g. on sign-out).
export async function unregisterPushToken(token: string): Promise<void> {
  const res = await authedFetch("/notifications/unregister", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Read the signed-in user's notification prefs.
export async function getNotifPrefs(): Promise<NotifPrefs> {
  const res = await authedFetch("/notifications/prefs");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { prefs: NotifPrefs };
  return body.prefs;
}

// Persist a partial prefs update; returns the merged prefs from the server.
export async function putNotifPrefs(prefs: Partial<NotifPrefs>): Promise<NotifPrefs> {
  const res = await authedFetch("/notifications/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefs }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { prefs: NotifPrefs };
  return body.prefs;
}

// Send a test push to all of the caller's registered devices.
export async function sendTestPush(): Promise<{ ok: boolean; sent: number }> {
  const res = await authedFetch("/notifications/test", { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { ok: boolean; sent: number };
}

export function getOdds(sport: string, signal?: AbortSignal): Promise<OddsGame[]> {
  return getJson<OddsGame[]>(`/sports/odds?sport=${encodeURIComponent(sport)}`, signal);
}

// ---------- Golf (PGA majors outright winner) ----------
// Mirrors artifacts/api-server golf.ts. Golf is OUTRIGHT-only (bet a golfer "to
// win the tournament"), so it lives on its own screen — it is deliberately NOT in
// the SPORTS list (which assumes head-to-head games + odds/coach/arb support).

export type GolfBookPrice = { book: string; price: number };

// One golfer in a tournament field. Every number is real bookmaker data:
// `price` is the BEST available American price (line-shopped across books),
// `fairProb` is the no-vig consensus win probability, and `edgePct`/`value`
// flag a price that beats that consensus (null when the golfer is a deep
// longshot whose edge can't be honestly computed).
export type GolfPlayer = {
  name: string;
  price: number;
  decimal: number;
  fairProb: number;
  edgePct: number | null;
  value: boolean;
  bookCount: number;
  books: GolfBookPrice[];
};

export type GolfTournament = {
  key: string;
  title: string;
  eventId: string;
  commenceTime: string;
  bookCount: number;
  field: GolfPlayer[];
};

export function getGolf(signal?: AbortSignal): Promise<GolfTournament[]> {
  return getJson<GolfTournament[]>("/sports/golf", signal);
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
  // The sportsbook behind the best price on each side (for arbitrage "where to
  // bet"). REAL book name from props.ts or null/absent — never fabricated.
  overBook?: string | null;
  underBook?: string | null;
  alt: boolean;
  headshot: string | null;
  athleteId: string | null;
  playerTeamId: string | null;
  // National-team crest, resolved server-side for World Cup soccer props (which
  // carry no team id). REAL ESPN logo or null — never guessed. Lets the avatar
  // fall back to a crest when there's no headshot.
  teamLogo?: string | null;
  // Cross-book +EV ("mispriced") signal (MAIN lines only; absent/null otherwise).
  // ev = EV% of the best posted price vs the no-vig cross-book consensus fair
  // value; evSide = the side that carries the edge; fairProb = consensus fair win
  // prob (0-1); edge = fairProb - best-price implied prob (percentage points);
  // books = # of two-sided books in the consensus. Computed server-side in
  // props.ts — REAL or omitted, never fabricated client-side.
  ev?: number | null;
  evSide?: "Over" | "Under" | null;
  fairProb?: number | null;
  edge?: number | null;
  books?: number;
  // Line-shopping spread per side (pct points): how much the best price beats
  // the cross-book median. Needs 2+ books on the side; null otherwise. REAL or
  // omitted — never fabricated. Grounds the prop rubric's Line-Shopping score.
  overSpread?: number | null;
  underSpread?: number | null;
};

export type PropsResponse = {
  home: string | null;
  away: string | null;
  bookmaker: string | null;
  props: PlayerProp[];
};

// Sports the props endpoint actually serves (MARKETS_BY_SPORT in props.ts).
// Tennis/ufc return [] upstream. Soccer serves props ONLY for the FIFA World Cup
// (anytime goalscorer / shots / shots on target); club-league soccer games come
// back empty and just narrow the pool — never fabricated.
export const PROPS_SPORTS = ["mlb", "wnba", "nba", "nhl", "nfl", "ncaaf", "ncaab", "soccer"];

// ---------- +500 Steals (mobile-only longshot value feed + W/L record) ----------

// A single longshot "steal": a live/upcoming bet at American odds +500..+30000
// that the server flagged as carrying a REAL cross-book no-vig edge. Every field
// is real or null — the server omits anything it can't price honestly.
export type LiveSteal = {
  id: string;
  sport: string;
  game: string;
  market: string;
  pick: string;
  player: string | null;
  price: number;
  edge: number | null;
  ev: number | null;
  fairProb: number | null;
  startsAt: string | null;
};

// Auto-graded W/L track record of the app's OWN steal picks (graded against real
// game/stat results — NOT the user's personal bets). `graded` = wins+losses+pushes.
export type StealRecord = {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  ungraded: number;
  graded: number;
};

export type LiveStealsResponse = {
  steals: LiveSteal[];
  record: StealRecord;
};

export function getLiveSteals(signal?: AbortSignal): Promise<LiveStealsResponse> {
  return getJson<LiveStealsResponse>(`/sports/live-steals`, signal);
}

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
  athleteId: string | null;
  // Soccer is fetched by player NAME (StatMuse), not athleteId (ESPN has no
  // soccer game log). Ignored by the ESPN-backed sports.
  name?: string | null;
  season?: string | null;
  opponentName?: string | null;
};

export function getPlayerHistory(
  args: GetPlayerHistoryArgs,
  signal?: AbortSignal,
): Promise<PlayerHistory> {
  const q = new URLSearchParams({ sport: args.sport });
  if (args.athleteId) q.set("athleteId", args.athleteId);
  if (args.name) q.set("name", args.name);
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

// ---------- MLB probables + ballpark + batter splits (real ESPN) ----------

// The opposing probable starter's real season tendency (the slice we use on the
// prop page). Mirrors the api-server PitcherTendency shape; honest nulls.
export type MlbPitcherTendency = {
  era: number | null;
  whip: number | null;
  ip: number | null;
  kPer9: number | null;
  hrAllowed: number | null;
  hrPer9: number | null;
  flyBallPct: number | null;
  groundFlyRatio: number | null;
  oppOPS: number | null;
  // Real Statcast (Baseball Savant) batted-ball-allowed profile; honest nulls.
  barrelPctAllowed: number | null;
  hardHitPctAllowed: number | null;
  battedBallEvents: number | null;
};

// One team's probable starting pitcher today, with throwing hand + tendency.
export type MlbProbable = {
  name: string;
  athleteId: string;
  throws: string | null; // ESPN display: "Left" / "Right" / null
  tendency: MlbPitcherTendency | null;
};

// Per-game ballpark environment keyed by the HOME team's ESPN id: real venue +
// static park HR factor + a live weather snapshot (null for domes / no key).
export type MlbGameEnv = {
  homeAbbr: string | null;
  venue: string | null;
  park: { hrIndex: number; altitudeFt: number; dome: boolean } | null;
  weather: { tempF: number | null; condition: string | null; windMph: number | null; humidity: number | null } | null;
};

export type MlbProbablesResp = {
  probables: Record<string, MlbProbable>; // keyed by ESPN teamId
  games?: Record<string, MlbGameEnv>; // keyed by HOME team ESPN id
};

// Today's probable starters per team + per-game ballpark environment. Cached on
// the server; returns empty buckets (never fabricated) on a miss.
export function getMlbProbables(signal?: AbortSignal): Promise<MlbProbablesResp> {
  return getJson<MlbProbablesResp>(`/sports/mlb-probables`, signal);
}

// A batter's REAL platoon line (season-to-date vs LHP / vs RHP) + handedness,
// straight from ESPN. Each split is a { label: number } map keyed by ESPN's own
// stat labels ("AVG", "OPS", ...); honest nulls when the feed has no data.
export type MlbBatterSplits = {
  athleteId: string;
  bats: string | null; // ESPN display: "Left" / "Right" / "Switch" / null
  vsLeft: Record<string, number> | null;
  vsRight: Record<string, number> | null;
};

export function getMlbBatterSplits(athleteId: string, signal?: AbortSignal): Promise<MlbBatterSplits> {
  return getJson<MlbBatterSplits>(`/sports/mlb-batter-splits?athleteId=${encodeURIComponent(athleteId)}`, signal);
}

// ---------- Real injury report (ESPN) ----------

// One player's REAL injury designation from ESPN's league-wide report.
export type InjuryEntry = {
  player: string;
  position: string | null;
  status: string;
  description: string;
};
// Injuries grouped by team (artifacts/api-server /sports/injuries).
export type InjuryTeam = {
  team: string;
  teamAbbr: string;
  entries: InjuryEntry[];
};

// League-wide injury report for a sport. Every status is ESPN's own real
// designation (Out / Questionable / Day-To-Day / ...). Returns [] on a miss.
export function getInjuries(
  sport: string,
  signal?: AbortSignal,
): Promise<InjuryTeam[]> {
  return getJson<InjuryTeam[]>(
    `/sports/injuries?sport=${encodeURIComponent(sport)}`,
    signal,
  );
}

// ---------- Coarse team defense (ESPN) ----------

// Real, coarse team-defense pack (artifacts/api-server /sports/team-defense).
// `avgPointsAgainst` is the only true "opponent allows" rate ESPN exposes per
// team without box-score aggregation — it is TEAM-WIDE, not position-specific.
export type TeamDefense = {
  sport: string;
  teamId: string;
  teamName: string | null;
  avgPointsAgainst: number | null;
  avgPointsFor: number | null;
  pointDifferential: number | null;
  defensive: Record<string, { value: number | null; displayValue: string | null }>;
  offensive: Record<string, { value: number | null; displayValue: string | null }>;
};

export function getTeamDefense(
  sport: string,
  teamId: string,
  signal?: AbortSignal,
): Promise<TeamDefense> {
  const q = new URLSearchParams({ sport, teamId });
  return getJson<TeamDefense>(`/sports/team-defense?${q.toString()}`, signal);
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
  player_goal_scorer_anytime: "Anytime Goal",
  player_shots_on_target: "Shots on Target",
  player_shots: "Shots",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_hits_runs_rbis: "Hits+Runs+RBIs",
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

// Reverse of propMarketLabel for the base (non-period) labels: resolve a human
// market label ("Strikeouts") back to its raw Odds API key ("pitcher_strikeouts")
// so a stored bet-slip leg — which keeps only the label — can open the right
// market on the prop stats page. Returns null for labels we don't recognize
// (e.g. period-suffixed ones), so callers fail closed instead of guessing.
const PROP_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(PROP_MARKET_LABELS).map(([k, v]) => [v.toLowerCase(), k]),
);

export function propMarketKeyForLabel(label: string): string | null {
  return PROP_LABEL_TO_KEY[label.trim().toLowerCase()] ?? null;
}

// ---------- Pickability window ----------
// These pure slate/pickability helpers live in ./slate (dependency-free so they
// are unit-testable under node --test). Re-exported here so the many existing
// `from "./api"` imports keep working unchanged.

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

// American odds -> implied win probability. Used to pick the single alt-ladder
// rung closest to even money for each side. -110 -> ~0.524, +150 -> 0.40.
const impliedProb = (american: number) =>
  american < 0 ? -american / (-american + 100) : 100 / (american + 100);

// Which odds sign an explicit "+ alt" / "- alt" ask should force across every
// game-level alt rung. "plus" = plus-money rungs only (aggressive upside);
// "minus" = minus-money rungs only (safer cushion). null = no constraint
// (closest-to-even default). Mobile emits ONE rung per side, so the sign is set
// here at context-build time, not by the model.
export type AltSign = "plus" | "minus" | null;
// Convert an OddsGame into real-odds PICK entries (main markets only — keeps the
// chat context compact). Same shape the web app sends as context.realOdds.
export function buildRealOdds(
  g: OddsGame,
  oddsThreshold?: OddsThreshold | null,
  includePeriods = false,
  signBias: AltSign = null,
): RealOddsEntry[] {
  if (!g || !g.markets) return [];
  const out: RealOddsEntry[] = [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const base = { sport: g.sport, game, startsAt: g.commenceTime };
  // Soccer team names are multi-word ("Czech Republic", "South Korea"); the
  // last-word `nickname` truncates them to a confusing, ambiguous moneyline /
  // spread label ("Republic ML") that doesn't clearly name the home/away side.
  // For soccer show the FULL team name so each leg reads "Czech Republic ML".
  // US leagues keep the nickname ("Los Angeles Lakers" -> "Lakers"), correct
  // there. The "Draw" outcome of a 3-way line is left as-is by either path.
  const isSoccer = g.sport === "soccer";
  const teamLabel = (name: string) => (isSoccer ? name : nickname(name));
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
  // Carry the server-computed no-vig / line-shopping inputs onto the entry so
  // the pick rubric can score Line Value + Line-Shopping from REAL numbers.
  const scoreInputs = (o: OddsOutcome) => ({
    noVigFair: o.noVigFair ?? null,
    edge: o.edge ?? null,
    bookSpread: o.bookSpread ?? null,
  });
  if (h2h) {
    for (const o of h2h.outcomes || []) {
      if (!mainOk(o.price)) continue;
      out.push({ ...base, market: "Moneyline", pick: `${teamLabel(o.name)} ML`, odds: o.price, ...scoreInputs(o) });
    }
  }
  if (spreads) {
    for (const o of spreads.outcomes || []) {
      if (!mainOk(o.price)) continue;
      const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
      out.push({ ...base, market: "Spread", pick: `${teamLabel(o.name)}${pt}`, odds: o.price, ...scoreInputs(o) });
    }
  }
  if (totals) {
    for (const o of totals.outcomes || []) {
      if (!mainOk(o.price)) continue;
      const pt = o.point == null ? "" : ` ${o.point}`;
      out.push({ ...base, market: "Total", pick: `${o.name}${pt}`.trim(), odds: o.price, ...scoreInputs(o) });
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
      // Explicit "+ alt" / "- alt" ask: force the rung's odds sign so every
      // game-level alt leg matches what the user asked for. A threshold already
      // implies the sign, so it takes precedence. If a side has no rung on the
      // requested sign it's simply omitted (never fabricated onto the wrong sign).
      if (signBias && !oddsThreshold) {
        if (signBias === "plus" && o.price < 0) continue;
        if (signBias === "minus" && o.price > 0) continue;
      }
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
          out.push({ ...base, market: `${plabel} Moneyline`, pick: `${teamLabel(o.name)} ML`, odds: o.price });
        }
      }
      if (psp) {
        for (const o of psp.outcomes || []) {
          if (o.price == null || !mainOk(o.price)) continue;
          const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
          out.push({ ...base, market: `${plabel} Spread`, pick: `${teamLabel(o.name)}${pt}`, odds: o.price });
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
    // Baseball INNINGS markets (game-level only — no per-player inning props).
    // F5 = first five innings. Labels mirror the web buildPicksFromOdds + chat
    // SYSTEM_PROMPT; PickCard marketFamily keeps each innings period distinct.
    const f5ml = g.markets.find((m) => m.key === "h2h_1st_5_innings");
    const f5sp = g.markets.find((m) => m.key === "spreads_1st_5_innings");
    const f5tot = g.markets.find((m) => m.key === "totals_1st_5_innings");
    const i1tot = g.markets.find((m) => m.key === "totals_1st_1_innings");
    if (f5ml) {
      for (const o of f5ml.outcomes || []) {
        if (o.price == null || !mainOk(o.price)) continue;
        out.push({ ...base, market: "F5 Moneyline", pick: `${nickname(o.name)} ML`, odds: o.price });
      }
    }
    if (f5sp) {
      for (const o of f5sp.outcomes || []) {
        if (o.price == null || !mainOk(o.price)) continue;
        const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
        out.push({ ...base, market: "F5 Run Line", pick: `${nickname(o.name)}${pt}`, odds: o.price });
      }
    }
    if (f5tot) {
      for (const o of f5tot.outcomes || []) {
        if (o.price == null || !mainOk(o.price)) continue;
        const pt = o.point == null ? "" : ` ${o.point}`;
        out.push({ ...base, market: "F5 Total", pick: `${o.name}${pt}`.trim(), odds: o.price });
      }
    }
    if (i1tot) {
      for (const o of i1tot.outcomes || []) {
        if (o.price == null || !mainOk(o.price)) continue;
        const pt = o.point == null ? "" : ` ${o.point}`;
        out.push({ ...base, market: "1st Inning Total", pick: `${o.name}${pt}`.trim(), odds: o.price });
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
  // ESPN athlete id (when the book line carried one) — lets the server join this
  // prop to its playerHistory / mlbPlatoon entry and dedupe same-display-name
  // players. Null when the feed didn't supply it.
  athleteId?: string | null;
  market: string;
  line: number | null;
  over: number | null;
  under: number | null;
  alt: boolean;
  // Cross-book +EV ("mispriced") signal (MAIN lines only; null otherwise). Lets
  // the chat AI surface real value props when asked. ev = EV% of the best price
  // vs no-vig consensus fair value; evSide = which side; fairProb = consensus fair
  // win prob (0-1); edge = fairProb - implied prob (pct points). Computed
  // server-side — REAL or null, never fabricated.
  ev?: number | null;
  evSide?: "Over" | "Under" | null;
  fairProb?: number | null;
  edge?: number | null;
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
  // Real cross-book scoring inputs for THIS side (null otherwise — never
  // fabricated). edge = no-vig value edge in pct points, present only on the
  // side the server flagged as the +EV side; bookSpread = line-shopping spread
  // (pct points) for this side. Ground the prop rubric's Line Value +
  // Line-Shopping sub-scores. Render-only — NEVER sent to the AI.
  edge?: number | null;
  bookSpread?: number | null;
  // Real event kickoff (ISO) carried from RealPropEntry. The today-only salvage
  // date-gates each prop by its OWN kickoff, so a repeated matchup (series play)
  // on a future date can't pass a game-label-only check and inherit today's time.
  startsAt?: string | null;
  // Render-only metadata (real ESPN data, never sent to the AI). headshot is the
  // player photo; teamAbbr is the player's team code resolved via playerTeamId.
  headshot?: string | null;
  teamAbbr?: string | null;
  // Identifiers carried so a resolved chat prop card can open the player's real
  // stats sheet: athleteId joins to the ESPN game log (null when the feed didn't
  // supply one — soccer falls back to player name); marketKey is the raw Odds API
  // market key (e.g. "player_points") the stat page reads to grade the line.
  // Both are render-only — NEVER sent to the AI.
  athleteId?: string | null;
  marketKey?: string;
};

// Render-only team metadata for game-level picks (logos + abbreviations). Built
// from ESPN games, keyed by the "Away @ Home" game string. NEVER sent to the AI
// — it's used by the card renderer to show the picked team's logo + code.
export type GameMeta = {
  game: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string | null;
  awayAbbr: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  startsAt: string | null;
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
      sport: g.sport,
      homeTeam: home,
      awayTeam: away,
      homeAbbr: g.homeAbbr ?? null,
      awayAbbr: g.awayAbbr ?? null,
      homeLogo: g.homeLogo ?? null,
      awayLogo: g.awayLogo ?? null,
      startsAt: g.startsAt ?? null,
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

// Round-robin items one-per-game per pass so a multi-game slate contributes
// ~equally and no game is starved by another's deep list.
function flattenRoundRobin(buckets: RealPropEntry[][]): RealPropEntry[] {
  const out: RealPropEntry[] = [];
  const max = buckets.reduce((m, b) => Math.max(m, b.length), 0);
  for (let i = 0; i < max; i++) {
    for (const b of buckets) if (i < b.length) out.push(b[i]);
  }
  return out;
}

// Pick up to `cap` props spread evenly across games instead of taking the first
// `cap` in arrival order. Crucially this is ALT-AWARE: alt ladder rungs are
// appended after every game's main lines, so a plain round-robin exhausts the
// cap on mains and the model never sees an alt rung to choose. We therefore
// reserve a slice of the cap for alts (round-robined across games too), then
// backfill any unused reserve with leftover mains. Mains still dominate; alts
// just get guaranteed representation so cushion/value swaps are actually possible.
// Interleave a single game's props by MARKET. Props arrive single-stats-first
// (points, rebounds, assists, …) with COMBO markets (Pts+Reb+Ast, Pts+Reb,
// Pts+Ast, Reb+Ast) and blocks/steals LAST, so a game's combo rungs sit at the
// tail of its block and get sliced off under cap pressure. Rotating markets puts
// one of each market up front, so combos and tail markets survive truncation.
function interleaveByMarket(entries: RealPropEntry[]): RealPropEntry[] {
  const m = new Map<string, RealPropEntry[]>();
  for (const p of entries) {
    const arr = m.get(p.market);
    if (arr) arr.push(p);
    else m.set(p.market, [p]);
  }
  return flattenRoundRobin([...m.values()]);
}

// Core breadth-balancer (no focal awareness — see balancePropsByGame for that).
function balancePropsCore(props: RealPropEntry[], cap: number): RealPropEntry[] {
  if (cap <= 0) return [];
  if (props.length <= cap) return props;
  // Two-level interleave: rotate markets WITHIN each game (so combos aren't shoved
  // to the tail of that game's block), THEN round-robin ACROSS games (so a deep
  // game doesn't starve the others). The first dimension fixes combo visibility;
  // the second preserves the per-game breadth guarantee.
  const mainsByGame = new Map<string, RealPropEntry[]>();
  const altsByGame = new Map<string, RealPropEntry[]>();
  for (const p of props) {
    const map = p.alt ? altsByGame : mainsByGame;
    const arr = map.get(p.game);
    if (arr) arr.push(p);
    else map.set(p.game, [p]);
  }
  const mainsOrdered = flattenRoundRobin([...mainsByGame.values()].map(interleaveByMarket));
  const altsOrdered = flattenRoundRobin([...altsByGame.values()].map(interleaveByMarket));
  // Reserve up to ~20% of the cap for alt rungs (never more than exist).
  const altReserve = Math.min(Math.floor(cap * 0.2), altsOrdered.length);
  const mainsTake = Math.min(mainsOrdered.length, cap - altReserve);
  const out: RealPropEntry[] = mainsOrdered.slice(0, mainsTake);
  for (const a of altsOrdered) {
    if (out.length >= cap) break;
    out.push(a);
  }
  // Alts were scarce — backfill the unused reserve with any leftover mains.
  for (let i = mainsTake; i < mainsOrdered.length && out.length < cap; i++) {
    out.push(mainsOrdered[i]);
  }
  return out;
}

// Does a realProps player name match any free-text player the user NAMED?
// Diacritic-insensitive (reuses normTennisName so "suarez" hits "Suárez"), and
// requires EVERY candidate name token of length >= 3 to be a whole word in the
// player name, so "schwarber" / "kyle schwarber" both hit Kyle Schwarber while a
// stray short filler token can't false-match an unrelated player.
function propPlayerMatchesNamed(player: string, candidates: string[]): boolean {
  const words = new Set(normTennisName(player).split(" ").filter(Boolean));
  if (!words.size) return false;
  return candidates.some((c) => {
    const toks = normTennisName(c).split(" ").filter((t) => t.length >= 3);
    return toks.length > 0 && toks.every((t) => words.has(t));
  });
}

// Breadth-balance props under `cap`, but when the user named a sport or game
// (focalText) give that focal slate PRIORITY for the cap. realOdds is already
// focal-ranked (see rankedOdds); realProps was NOT, so a single prop-rich focal
// game — e.g. the lone NBA game on an MLB-heavy June night — was diluted to a
// ~1/N round-robin share across every sport's games. That silently starved
// N-leg builds: a "10 leg NBA" ask only surfaced ~8 NBA players and honestly
// stalled at 8 even though that one game posts 19 players + full period ladders.
// Fix: fill the cap from the focal slate first (still breadth-balanced across
// focal games + combo-aware within each), then backfill any leftover cap with
// the rest of the slate so non-focal breadth is preserved when room remains.
function balancePropsByGame(props: RealPropEntry[], cap: number, focalText?: string | null): RealPropEntry[] {
  if (props.length <= cap) return props;
  if (focalText) {
    // FLOAT NAMED PLAYERS FIRST: a bare player name in the question (e.g. "is
    // Schwarber a good HR play?" or "Suarez, Buxton, Schwarber, Freeman for HR")
    // is NOT caught by the sport/game focal match below, so on a busy slate a
    // named hitter's line was round-robined out of the 400-cap pool and the coach
    // wrongly reported "I don't have him on tonight's board." Reserve cap room so
    // any player the user named always survives, then balance the rest normally.
    const named = extractNamedCandidates(focalText);
    if (named.length) {
      const isNamed = (p: RealPropEntry) => propPlayerMatchesNamed(String(p.player || ""), named);
      const namedProps = props.filter(isNamed);
      if (namedProps.length) {
        const rest = props.filter((p) => !isNamed(p));
        // If the named players alone exceed the cap (very long name list),
        // breadth-balance WITHIN the named set so it still spans their games
        // rather than overflowing in arrival order. Otherwise keep all named
        // rows and backfill the remaining cap with the normally-balanced rest.
        const out =
          namedProps.length >= cap ? balancePropsCore(namedProps, cap) : namedProps.slice(0, cap);
        if (out.length < cap) out.push(...balancePropsByGame(rest, cap - out.length, focalText));
        return out.slice(0, cap);
      }
    }
    const focalSports = focalSportsFromText(focalText);
    const isFocal = (p: RealPropEntry) =>
      gameMatchesFocalText(p.game, focalText) || focalSports.has(p.sport);
    const focal = props.filter(isFocal);
    if (focal.length && focal.length < props.length) {
      const rest = props.filter((p) => !isFocal(p));
      const out = balancePropsCore(focal, cap);
      if (out.length < cap) out.push(...balancePropsCore(rest, cap - out.length));
      return out.slice(0, cap);
    }
  }
  return balancePropsCore(props, cap);
}

export type ChatContext = {
  selectedSports: string[];
  currentSlip: { game: string; market: string; pick: string; odds: number }[];
  realGames: RealGameEntry[];
  realOdds: RealOddsEntry[];
  realProps: RealPropEntry[];
  // Real prior-matchup analytics keyed by "Away @ Home" — mirrors the web app so
  // the coach weighs L10/season/venue/streak/H2H (+ mlLean winner & upset) rather
  // than odds alone. Optional: omitted when no pickable game resolved history.
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  // Real UFC fight breakdowns keyed by "Away @ Home" — fighter records + career
  // striking/grappling rates + a deterministic stronger-fighter lean (with .upset
  // when that fighter is also the betting dog). Combat sports only; omitted when
  // no UFC bout resolved real data.
  fightAnalysis?: Record<string, FightAnalysis>;
  // Real ESPN per-player game logs keyed by "Player Name#athleteId" — recent
  // form + vs-opponent + home/away & venue-correct split — so the coach defends
  // a prop with real numbers, not the book price. Omitted when none resolved.
  playerHistory?: Record<string, unknown>;
  // MLB batter handedness vs the opposing probable starter (platoon edge + the
  // batter's real vs-LHP/RHP split + the starter's real season tendency), keyed
  // "Player#athleteId". The server auto-builds the batter-vs-pitcher career line
  // from this. Omitted when no MLB batter resolved a split.
  mlbPlatoon?: Record<string, unknown>;
  // Per-MLB-game ballpark environment keyed by "Away @ Home": real park HR
  // factor + altitude, real ballpark weather (null for domes), and both probable
  // starters' real tendency. Omitted when no MLB game resolved data.
  mlbGameEnv?: Record<string, unknown>;
  // Soft signal derived ONLY from the user's REAL graded results (Model Report):
  // short strings like "Unders: strong (61%, 11-7)" for categories above the
  // sample bar. The model may lean into hot categories / be cautious on cold
  // ones, but it's advisory only and never overrides real matchup analytics.
  // Omitted when not enough has settled to say anything honest.
  modelStrengths?: string[];
  // Real ESPN injury report distilled per pickable game, keyed by "Away @ Home"
  // (matching realGames/realOdds). Each side lists the key players actually out
  // (with a friendly status + a high/med impact tier) plus per-position-group
  // counts, and a deterministic injury EDGE (the less-banged-up side). Impact is
  // a transparent guide from real severity × position — NOT a fabricated player
  // rating. Omitted when no pickable game had a betting-relevant injury.
  matchupInjuries?: Record<string, GameInjuryReport>;
};

// One real upset spot — a game where the app's deterministic analytics lean
// (mlLean) sits on the BETTING UNDERDOG (longer/plus-money real ML price).
export type UpsetSpot = {
  game: string;
  sport: string;
  side: string;
  dogOdds: number;
  edge: number;
  reasons: string[];
  startsAt?: string;
};

// ---------- UFC fight analysis (real ESPN MMA records + career rates) ----------
// Mirror of the api-server lib/ufc.ts shapes. Combat sports are moneyline-only,
// so this is the one analytics layer we can build for them. Every number is real
// ESPN data; honest-null cells when ESPN carries no value. Boxing is NOT
// supported (no data source) and is never analysed here.
export type FightFighterStats = {
  strikeAccuracy: number | null;
  strikeLPM: number | null;
  takedownAccuracy: number | null;
  takedownAvg: number | null;
  submissionAvg: number | null;
  finishPct: number | null;
  decisionPct: number | null;
};
export type FightFighter = {
  name: string;
  resolvedName: string | null;
  athleteId: string | null;
  weightClass: string | null;
  record: { wins: number; losses: number; draws: number; winPct: number } | null;
  stats: FightFighterStats;
};
export type FightLean = { side: string; edge: number; reasons: string[]; upset?: { dogOdds: number } };
export type FightAnalysis = { away: FightFighter; home: FightFighter; lean: FightLean | null };

// Fetch the real fight breakdown for one UFC bout (records + striking/grappling
// rates + a deterministic stronger-fighter lean). Returns null on a failed/empty
// fetch — the caller treats that as "no data", never fabricates.
export async function getFightAnalysis(away: string, home: string, signal?: AbortSignal): Promise<FightAnalysis | null> {
  const qs = `away=${encodeURIComponent(away)}&home=${encodeURIComponent(home)}`;
  try {
    return await getJson<FightAnalysis>(`/sports/fight-analysis?${qs}`, signal);
  } catch {
    return null;
  }
}

// ---------- Tennis matchup (routes/tennis.ts) ----------

export type TennisRecentResult = {
  date: string;
  opponent: string | null;
  win: boolean | null;
  score: string | null;
  round: string | null;
};
export type TennisPlayer = {
  name: string;
  resolvedName: string | null;
  athleteId: string | null;
  country: string | null;
  rank: number | null;
  rankPoints: number | null;
  tour: "ATP" | "WTA" | null;
  recentForm: TennisRecentResult[];
  formSummary: { wins: number; losses: number } | null;
};
export type TennisH2H = {
  homeWins: number;
  awayWins: number;
  meetings: TennisRecentResult[];
} | null;
export type TennisMatchup = {
  away: TennisPlayer;
  home: TennisPlayer;
  h2h: TennisH2H;
  tournament: string | null;
  round: string | null;
};

export type TennisBio = {
  age: number | null;
  height: string | null;
  weight: string | null;
  plays: string | null;
  turnedPro: number | null;
  birthPlace: string | null;
};
export type TennisCareer = {
  wins: number | null;
  losses: number | null;
  winPct: number | null;
  singlesTitles: number | null;
  doublesTitles: number | null;
  prize: number | null;
};
export type TennisPlayerProfile = {
  name: string;
  resolvedName: string | null;
  athleteId: string | null;
  tour: "ATP" | "WTA" | null;
  country: string | null;
  rank: number | null;
  rankPoints: number | null;
  bio: TennisBio | null;
  career: TennisCareer | null;
  recentForm: TennisRecentResult[];
  formSummary: { wins: number; losses: number } | null;
};

// Fetch a real tennis player's full stats sheet (ranking + bio + career singles
// record + recent form). Returns null on a failed fetch — the caller treats that
// as "no data" and never fabricates.
export async function getTennisPlayer(
  name: string,
  signal?: AbortSignal,
): Promise<TennisPlayerProfile | null> {
  const n = name.trim();
  if (!n) return null;
  try {
    return await getJson<TennisPlayerProfile>(
      `/sports/tennis-player?name=${encodeURIComponent(n)}`,
      signal,
    );
  } catch {
    return null;
  }
}

// Fetch the real tennis matchup (both players' ATP/WTA rank + country + season
// recent form + recent head-to-head). Returns null on a failed/empty fetch —
// the caller treats that as "no data" and never fabricates.
export async function getTennisMatchup(
  away: string,
  home: string,
  signal?: AbortSignal,
): Promise<TennisMatchup | null> {
  const qs = `away=${encodeURIComponent(away)}&home=${encodeURIComponent(home)}`;
  try {
    return await getJson<TennisMatchup>(`/sports/tennis-matchup?${qs}`, signal);
  } catch {
    return null;
  }
}

// ---------- Tennis country flags (routes/tennis.ts) ----------

// A single player's REAL ESPN country flag. Tennis players have no club crest,
// so the Upcoming cards show the country flag instead of plain initials.
export type TennisFlag = {
  displayName: string;
  country: string | null;
  flag: string | null; // ESPN flag image URL, or null when ESPN has none
};

// Diacritic-/punctuation-insensitive player-name key. Must mirror the server's
// normName (lib/tennis.ts) so the odds-feed player names match the ESPN draw
// names the flags map is keyed by.
export function normTennisName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Fetch the name-keyed country-flag map for every player in an active ATP/WTA
// draw. One cached request serves the whole tennis slate. Returns {} on any
// failure so the cards just fall back to initials (never fabricated).
export async function getTennisFlags(
  signal?: AbortSignal,
): Promise<Record<string, TennisFlag>> {
  try {
    return await getJson<Record<string, TennisFlag>>("/sports/tennis-flags", signal);
  } catch {
    return {};
  }
}

// Resolve a player's REAL country-flag URL from the flags map. Tries the full
// normalized name first, then a UNIQUE surname fallback (the odds feed and ESPN
// occasionally differ on first-name form). An ambiguous surname or a player
// ESPN doesn't carry returns null — the card falls back to initials, never a
// guessed flag.
export function resolveTennisFlag(
  flags: Record<string, TennisFlag> | undefined,
  name: string,
): string | null {
  if (!flags || !name) return null;
  const key = normTennisName(name);
  const direct = flags[key];
  if (direct?.flag) return direct.flag;
  const surname = key.split(" ").filter(Boolean).pop();
  if (!surname) return null;
  let hit: TennisFlag | null = null;
  for (const [k, v] of Object.entries(flags)) {
    const last = k.split(" ").filter(Boolean).pop();
    if (last === surname && v.flag) {
      if (hit) return null; // ambiguous surname — don't guess
      hit = v;
    }
  }
  return hit?.flag ?? null;
}

// Compact matchup-history entry sent to the AI (mirror of the web shape).
export type MatchupHistoryEntry = {
  home: unknown;
  away: unknown;
  // Real possessions pace (NBA / WNBA only) for each team, from StatMuse. Null
  // for other sports or on any miss — never fabricated.
  homePace: number | null;
  awayPace: number | null;
  homeVenueForm: unknown;
  awayVenueForm: unknown;
  homeStreak: unknown;
  awayStreak: unknown;
  homeSeason: unknown;
  awaySeason: unknown;
  homeRest: unknown;
  awayRest: unknown;
  h2h: unknown;
  // Real box score of the two teams' most recent completed meeting (ESPN team
  // totals + statistical leaders) so the coach can answer "what did we learn
  // last game / how do we adjust" with real numbers. Null when they haven't met
  // or ESPN has no box detail.
  lastMeeting: unknown;
  mlLean: { side: string; edge: number; reasons: string[]; upset?: { dogOdds: number } } | null;
};

// The lean real-data context sent to the AI, PLUS render-only metadata (player
// headshots, team logos/abbrs) the card renderer uses. The metadata is returned
// separately so it never bloats the AI request body (streamChat sends `context`
// only) yet the slip/coach can still show real photos + logos on each pick.
export type BuiltChatContext = {
  context: ChatContext;
  propPool: PropPoolEntry[];
  gameMeta: GameMeta[];
  // Real upset spots (mlLean on the betting dog), sorted by edge desc. Powers the
  // mobile Upset Watch card; the coach gets the same signal via matchupHistory.
  upsetSpots: UpsetSpot[];
  // The EFFECTIVE today-only decision actually applied to these pools (after the
  // resolveTodayOnly late-evening fallback). Callers MUST use this — not a fresh
  // wantsTodayOnly(text) — when post-filtering parsed picks, or they'd re-impose
  // the strict today-only filter the context build deliberately relaxed and zero
  // out the (real, tomorrow) slate again.
  todayOnly: boolean;
};

// ---------- Upset Watch / moneyline-lean engine (port of the web app) ----------

// Real matchup-history feed for one game (last-10 form, venue splits, streak,
// season, H2H). Same endpoint the web Upset Watch + chat builder use.
async function getMatchupHistory(sport: string, homeTeamId: string, awayTeamId: string, signal?: AbortSignal): Promise<any> {
  const qs = `sport=${encodeURIComponent(sport)}&homeTeamId=${encodeURIComponent(homeTeamId)}&awayTeamId=${encodeURIComponent(awayTeamId)}`;
  return getJson<any>(`/sports/matchup-history?${qs}`, signal);
}

const _clampLean = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const _streakStr = (s: any) => (s && s.count > 0 ? (s.type === "W" ? s.count : -s.count) : 0);
// Deterministic moneyline lean — VERBATIM port of the web computeMlLean so both
// platforms produce the identical analytics-favored winner from the same real
// data (no drift). Pure function of the matchup-history feed.
const computeMlLean = (label: string, d: any): { side: string; edge: number; reasons: string[]; upset?: { dogOdds: number } } | null => {
  const parts = (label || "").split(" @ ");
  const awayNm = (parts[0] || "").trim();
  const homeNm = (parts[1] || "").trim();
  if (!awayNm || !homeNm || !d) return null;
  const h10 = d?.home?.last10, a10 = d?.away?.last10;
  const hSeas = d?.home?.season, aSeas = d?.away?.season;
  const hVen = (d?.home?.homeSplit?.games > 0) ? d.home.homeSplit : null;
  const aVen = (d?.away?.awaySplit?.games > 0) ? d.away.awaySplit : null;
  const h2h = d?.h2h?.meetings?.length ? d.h2h : null;
  let edge = 0; let any = false;
  if (h10?.avgMargin != null && a10?.avgMargin != null) { edge += _clampLean((h10.avgMargin - a10.avgMargin) * 1.2, -10, 10); any = true; }
  if (hSeas?.winPct != null && aSeas?.winPct != null) { edge += _clampLean((hSeas.winPct - aSeas.winPct) * 15, -8, 8); any = true; }
  if (hVen?.avgMargin != null && aVen?.avgMargin != null) { edge += _clampLean((hVen.avgMargin - aVen.avgMargin) * 0.9, -6, 6); any = true; }
  const sd = _streakStr(d?.home?.streak) - _streakStr(d?.away?.streak);
  if (sd !== 0) { edge += _clampLean(sd * 1.2, -5, 5); any = true; }
  if (h2h) { edge += _clampLean((h2h.homeWins - h2h.awayWins) * 2, -5, 5); any = true; }
  if (!any || Math.abs(edge) < 1) return null;
  const homeFav = edge > 0;
  const side = homeFav ? homeNm : awayNm;
  const reasons: string[] = [];
  const favL10 = homeFav ? h10 : a10, oppL10 = homeFav ? a10 : h10;
  if (favL10?.avgMargin != null) reasons.push(`${side} ${favL10.wins}-${favL10.losses} L10 (${favL10.avgMargin > 0 ? "+" : ""}${favL10.avgMargin} margin)${oppL10?.avgMargin != null ? ` vs ${oppL10.wins}-${oppL10.losses} (${oppL10.avgMargin > 0 ? "+" : ""}${oppL10.avgMargin})` : ""}`);
  const favSeas = homeFav ? hSeas : aSeas;
  if (favSeas?.winPct != null) reasons.push(`${favSeas.wins}-${favSeas.losses} season (${Math.round(favSeas.winPct * 100)}% win)`);
  const favVen = homeFav ? hVen : aVen;
  if (favVen) reasons.push(`${favVen.wins}-${favVen.losses} ${homeFav ? "at home" : "on the road"} (${favVen.avgMargin > 0 ? "+" : ""}${favVen.avgMargin} margin)`);
  const favStreak = homeFav ? d?.home?.streak : d?.away?.streak;
  if (favStreak && favStreak.type === "W" && favStreak.count >= 2) reasons.push(`${favStreak.count}-game win streak`);
  if (h2h) { const fw = homeFav ? h2h.homeWins : h2h.awayWins, fl = homeFav ? h2h.awayWins : h2h.homeWins; if (fw !== fl) reasons.push(`${fw}-${fl} H2H last ${h2h.meetings.length}`); }
  if (reasons.length === 0) reasons.push(`${side} holds the edge on combined form, season, venue and streak metrics`);
  return { side, edge: Math.round(Math.abs(edge) * 10) / 10, reasons };
};

// Build { "Away @ Home" -> { nickname -> americanPrice } } from the FLAT realOdds
// rows (mobile stores one row per pick; moneyline rows are "<nick> ML").
const buildMlPriceByLabel = (realOdds: RealOddsEntry[]): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  for (const r of realOdds || []) {
    if (r.market !== "Moneyline") continue;
    const nick = (r.pick || "").replace(/\s+ML$/i, "").trim();
    if (!nick) continue;
    (out[r.game] ||= {})[nick] = r.odds;
  }
  return out;
};

// Mark a lean as an upset when mlLean.side carries the LONGER (numerically
// greater) real American price and it is genuine plus-money (>= +100). Mutates
// + returns the lean. Real prices only — never fabricated.
const detectUpset = (lean: any, pricesByNick?: Record<string, number>) => {
  if (!lean?.side || !pricesByNick) return lean;
  const sidePrice = pricesByNick[nickname(lean.side)];
  if (sidePrice == null) return lean;
  let oppPrice: number | null = null;
  for (const [nm, pr] of Object.entries(pricesByNick)) { if (nm !== nickname(lean.side)) { oppPrice = pr; break; } }
  if (oppPrice == null) return lean;
  if (sidePrice > oppPrice && sidePrice >= 100) lean.upset = { dogOdds: sidePrice };
  return lean;
};

// Build the matchupHistory map (mirror of the web shape) + the upset-spot list
// from pickable games (with team ids) and the real ML price map. Caps at 16
// matchup-history fetches; failures are honest skips (never fabricated).
async function buildMatchupHistoryAndUpsets(
  targets: { sport: string; gameLabel: string; homeTeamId: string; awayTeamId: string; startsAt?: string }[],
  mlPriceByLabel: Record<string, Record<string, number>>,
  signal?: AbortSignal,
  focalText?: string | null,
  matchupCap = 16,
): Promise<{ matchupHistory: Record<string, MatchupHistoryEntry>; upsetSpots: UpsetSpot[] }> {
  const matchupHistory: Record<string, MatchupHistoryEntry> = {};
  const upsetSpots: UpsetSpot[] = [];
  // The matchup-history fetch is globally capped (one ESPN round-trip per game) to
  // bound cost. When the user named a sport/game, give that focal slate the first
  // slots so a lone focal game (e.g. one NBA game on an MLB-heavy night) is never
  // sliced off — otherwise the coach sees "no matchupHistory" and gives a thinner
  // read. Mirrors the focal-priority pass for realProps.
  let ordered = targets;
  if (focalText) {
    const focalSports = focalSportsFromText(focalText);
    const isFocal = (t: { sport: string; gameLabel: string }) =>
      gameMatchesFocalText(t.gameLabel, focalText) || focalSports.has(t.sport);
    const focal = targets.filter(isFocal);
    if (focal.length > 0 && focal.length < targets.length) {
      ordered = [...focal, ...targets.filter((t) => !isFocal(t))];
    }
  }
  await Promise.all(
    ordered.slice(0, matchupCap).map(async (t) => {
      try {
        const data = await getMatchupHistory(t.sport, t.homeTeamId, t.awayTeamId, signal);
        const home10 = data?.home?.last10;
        const away10 = data?.away?.last10;
        const h2h = data?.h2h;
        if (!home10 && !away10 && !(h2h?.meetings?.length)) return;
        const gameStart = t.startsAt ? new Date(t.startsAt).getTime() : null;
        const computeRest = (lastDate: string | null) => {
          if (!lastDate || gameStart == null) return null;
          const diffMs = gameStart - new Date(lastDate).getTime();
          if (!Number.isFinite(diffMs) || diffMs < 0) return null;
          const restDays = Math.floor(diffMs / 86400000);
          return { restDays, backToBack: restDays <= 1 };
        };
        const splitOf = (s: any) => (s && s.games > 0
          ? { record: `${s.wins}-${s.losses}`, avgMargin: s.avgMargin, ptsFor: s.ptsFor, ptsAgainst: s.ptsAgainst, games: s.games } : null);
        const seasonOf = (s: any) => (s && s.games > 0 ? { record: `${s.wins}-${s.losses}`, winPct: s.winPct } : null);
        const lean = computeMlLean(t.gameLabel, data);
        if (lean) detectUpset(lean, mlPriceByLabel[t.gameLabel]);
        matchupHistory[t.gameLabel] = {
          home: home10 ? { record: `${home10.wins}-${home10.losses}`, ptsFor: home10.ptsFor, ptsAgainst: home10.ptsAgainst, avgMargin: home10.avgMargin } : null,
          away: away10 ? { record: `${away10.wins}-${away10.losses}`, ptsFor: away10.ptsFor, ptsAgainst: away10.ptsAgainst, avgMargin: away10.avgMargin } : null,
          homePace: typeof data?.home?.pace === "number" ? data.home.pace : null,
          awayPace: typeof data?.away?.pace === "number" ? data.away.pace : null,
          homeVenueForm: splitOf(data?.home?.homeSplit),
          awayVenueForm: splitOf(data?.away?.awaySplit),
          homeStreak: data?.home?.streak || null,
          awayStreak: data?.away?.streak || null,
          homeSeason: seasonOf(data?.home?.season),
          awaySeason: seasonOf(data?.away?.season),
          homeRest: computeRest(data?.home?.lastGameDate ?? null),
          awayRest: computeRest(data?.away?.lastGameDate ?? null),
          h2h: h2h?.meetings?.length
            ? { homeWins: h2h.homeWins, awayWins: h2h.awayWins, meetings: h2h.meetings.slice(0, 3).map((m: any) => ({ date: m.date, homeScore: m.homeTeamScore, awayScore: m.awayTeamScore, homeMargin: m.homeTeamWonByMargin })) }
            : null,
          lastMeeting: data?.lastMeeting ?? null,
          mlLean: lean,
        };
        if (lean?.upset) {
          upsetSpots.push({ game: t.gameLabel, sport: t.sport, side: lean.side, dogOdds: lean.upset.dogOdds, edge: lean.edge, reasons: lean.reasons || [], startsAt: t.startsAt });
        }
      } catch { /* honest no-history skip */ }
    }),
  );
  upsetSpots.sort((a, b) => b.edge - a.edge);
  return { matchupHistory, upsetSpots };
}

// Standalone fetch for the Upset Watch card: pulls odds + games for the selected
// sports, builds the real ML price map + history targets, and returns ONLY the
// upset spots (decoupled from the heavier buildChatContext). Real data only.
export async function fetchUpsetSpots(sports: string[], signal?: AbortSignal): Promise<UpsetSpot[]> {
  const [oddsAll, gamesAll] = await Promise.all([
    Promise.all(sports.map((s) => getOdds(s, signal).catch(() => [] as OddsGame[]))),
    Promise.all(sports.map((s) => getGames(s, signal).catch(() => [] as EspnGame[]))),
  ]);
  const realOdds: RealOddsEntry[] = [];
  const targets: { sport: string; gameLabel: string; homeTeamId: string; awayTeamId: string; startsAt?: string }[] = [];
  sports.forEach((sport, i) => {
    for (const g of oddsAll[i]) {
      if (!isPickable(g.commenceTime)) continue;
      realOdds.push(...buildRealOdds(g));
    }
    for (const g of gamesAll[i]) {
      if (g.state === "post") continue;
      if (!isPickable(g.startsAt)) continue;
      const away = g.awayTeam || g.awayAbbr || "";
      const home = g.homeTeam || g.homeAbbr || "";
      if (!away || !home || !g.homeTeamId || !g.awayTeamId) continue;
      targets.push({ sport, gameLabel: `${away} @ ${home}`, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, startsAt: g.startsAt });
    }
  });
  const { upsetSpots } = await buildMatchupHistoryAndUpsets(targets, buildMlPriceByLabel(realOdds), signal);
  return upsetSpots;
}

// Filler/request words stripped from a free-text form question so what remains
// is just the player name(s). DELIBERATELY excludes real first-name words like
// "will"/"may"/"cam" (see player-name-extraction memory) so they never get
// stripped out of a real name. Single-token candidates are additionally gated by
// NAME_FALLBACK_SKIP, and every candidate is resolved against a real ESPN search
// with a whole-word guard, so an over-broad leftover simply fails to resolve.
const NAME_REQUEST_FILLER =
  /\b(?:do|you|i|we|like|likes|liking|want|wanna|need|rate|back|backing|think|thinks|thought|feel|feels|love|loves|how|hows|what|whats|whos|about|thoughts|read|reads|reading|look|looking|lookup|get|show|tell|give|pull|up|of|on|to|too|for|in|with|my|me|some|any|good|great|best|top|hot|cold|the|a|an|and|or|but|that|these|those|this|guy|guys|player|players|hitter|hitters|batter|batters|home|homer|homers|hr|hrs|run|runs|hit|hits|hitting|form|recent|recently|lately|last|game|games|gamelog|boxscore|tonight|today|tomorrow|night|season|seasons|career|over|under|line|lines|prop|props|odds|stat|stats|statline|number|numbers|split|splits|projection|project|projecting|going|deep|xbh|slug|slugging|streak|streaks|vs|versus|against|are|is|am|was|were|does|did|would|should|could)\b/gi;

// Pull candidate player-NAME phrases out of a free-text form question. Splits on
// list delimiters (commas, "and", "&", "/", "vs", newlines) so a multi-name ask
// ("Seager, Pederson and Nimmo") yields one candidate per hitter, then strips
// request verbs / stat words / filler from each so what's left is just the name.
function extractNamedCandidates(text: string): string[] {
  const segs = String(text || "")
    .replace(/[?!.;:]/g, " ")
    .split(/,|\/|&|\n|\bvs\.?\b|\bversus\b|\band\b/gi);
  const out: string[] = [];
  const seenStr = new Set<string>();
  for (const seg of segs) {
    let s = ` ${seg.toLowerCase()} `;
    s = s.replace(NAME_REQUEST_FILLER, " ");
    s = s.replace(/[^a-z'.\- ]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) continue;
    const toks = s.split(" ").filter((w) => w.length >= 2);
    if (toks.length < 1 || toks.length > 3) continue;
    if (toks.length === 1 && NAME_FALLBACK_SKIP.has(toks[0])) continue;
    const cand = toks.join(" ");
    if (seenStr.has(cand)) continue;
    seenStr.add(cand);
    out.push(cand);
  }
  return out;
}

// Fetch live odds + games across the selected sports and assemble the real-data
// context the chat AI requires so it never fabricates fixtures or prices.
export async function buildChatContext(
  sports: string[],
  currentSlip: { game: string; market: string; pick: string; odds: number }[],
  signal?: AbortSignal,
  oddsThreshold?: OddsThreshold | null,
  includePeriods = false,
  focalText?: string | null,
  altSign: AltSign = null,
  requestedLegs = 0,
  analyzeSlip = false,
): Promise<BuiltChatContext> {
  // Scale how much of the slate we send the model to the ticket size the user
  // asked for (small parlays don't need the whole night's pool). Big tickets keep
  // full breadth. See contextDepthForLegs for the why (latency) and the tiers.
  const depth = contextDepthForLegs(requestedLegs, MAX_PROPS_IN_CONTEXT);
  // Keep the two feed types in separately-typed arrays so handling stays
  // type-safe; resilient per-sport (a failed fetch just yields an empty list).
  // Fast path: fan out odds+games for every sport at once.
  const fetchCoreParallel = (sig?: AbortSignal): Promise<[OddsGame[][], EspnGame[][]]> =>
    Promise.all([
      Promise.all(sports.map((s) => getOdds(s, sig).catch(() => [] as OddsGame[]))),
      Promise.all(sports.map((s) => getGames(s, sig).catch(() => [] as EspnGame[]))),
    ]);
  // Slow, saturation-proof path for the weak-link retry: with ~12 sports the
  // parallel fan-out is 24+ simultaneous requests, which can saturate a
  // constrained uplink (congested cell / iOS Low Power Mode) so every request
  // races — and loses — the per-request timeout, yielding all-empty pools.
  // Fetching one sport at a time gives each request the full pipe so the retry
  // actually completes. Still fail-soft per request (never fabricates).
  const fetchCoreSequential = async (sig?: AbortSignal): Promise<[OddsGame[][], EspnGame[][]]> => {
    const odds: OddsGame[][] = [];
    const games: EspnGame[][] = [];
    for (const s of sports) {
      // Two concurrent requests per sport (odds + its games) keeps the
      // saturation-proof one-sport-at-a-time profile while halving the
      // worst-case wall-clock vs. awaiting each feed separately.
      const [o, g] = await Promise.all([
        getOdds(s, sig).catch(() => [] as OddsGame[]),
        getGames(s, sig).catch(() => [] as EspnGame[]),
      ]);
      odds.push(o);
      games.push(g);
    }
    return [odds, games];
  };
  const anyNonEmpty = (lists: { length: number }[]): boolean => lists.some((l) => l.length > 0);

  let [[oddsAll, gamesAll], injuriesAll] = await Promise.all([
    fetchCoreParallel(signal),
    // Real ESPN injury report per sport (for the per-game injury read the coach
    // factors into picks). A failed/unsupported sport just yields [] — never
    // fabricated; sports without a report (tennis/ufc) simply contribute none.
    Promise.all(sports.map((s) => getInjuries(s, signal).catch(() => [] as InjuryTeam[]))),
  ]);

  // BOTH core pools coming back completely empty is the signature of a transient
  // fetch failure on a weak link (per-request timeout under burst saturation, or
  // a rate-limit window) — NOT a genuinely empty slate, since an in-season night
  // always has at least one posted game. If we trusted this empty result the
  // coach would falsely tell the user "the live slate isn't loaded / no games
  // tonight". So retry ONCE, sequentially, after a brief pause (to clear any
  // rate-limit window AND avoid re-saturating the link) before accepting empty.
  // Still fail-closed: if it's truly empty after the retry, we proceed honestly.
  if (!anyNonEmpty(oddsAll) && !anyNonEmpty(gamesAll)) {
    await new Promise<void>((r) => setTimeout(r, 600));
    [oddsAll, gamesAll] = await fetchCoreSequential(signal);
  }

  const realOdds: RealOddsEntry[] = [];
  const realGames: RealGameEntry[] = [];
  // Real per-game injury report keyed by "Away @ Home" (matches realGames). Only
  // games with a betting-relevant injury get an entry (buildGameInjuryReport
  // returns null otherwise), so this stays compact and noise-free.
  const matchupInjuries: Record<string, GameInjuryReport> = {};

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

  // Team-id'd pickable games → targets for the real matchup-history fetch (mlLean
  // + upset). Capped at 12 per sport, mirroring the web builder's history pool.
  const historyTargets: { sport: string; gameLabel: string; homeTeamId: string; awayTeamId: string; startsAt?: string }[] = [];
  // Normally only the 48h betting window (isPickable) is in context. But a
  // playoff-series lookahead question ("what did we learn in game 2 for game 3")
  // is about the NEXT game, which can be a few days out — past isPickable and
  // often with no posted odds yet (so isPickable + the odds pool both drop it,
  // and the coach truthfully says "that matchup isn't loaded"). So when the user
  // NAMES a sport/game, allow that focal sport's upcoming games a wider horizon
  // into the matchup-history pool, BOUNDED per sport so a non-focal or broad ask
  // never pulls a week of slates and bloats the context.
  // A "today / tonight" ask restricts every pool to games that tip off later on
  // the user's LOCAL calendar day. But late in the evening that set is often
  // EMPTY — tonight's games have all already started, and the next posted slate
  // in the feed is tomorrow. Applying the restriction then would empty realOdds,
  // realGames AND realProps, so the coach falsely reports "the live board isn't
  // loaded — no games tonight" on a full slate. resolveTodayOnly drops the
  // restriction in exactly that case (asked, but nothing qualifies as
  // today-and-upcoming) so we fall back to the normal next-48h pickable window.
  // Every game carries its real startsAt, so the coach can still see (and say)
  // they're tomorrow's slate — nothing is fabricated; we just stop hiding the
  // only real games we have.
  const candidateStartTimes: (string | null | undefined)[] = [
    ...oddsAll.flat().map((g) => g.commenceTime),
    ...gamesAll.flat().filter((g) => g.state !== "post").map((g) => g.startsAt),
  ];
  const todayOnly = resolveTodayOnly(wantsTodayOnly(focalText), candidateStartTimes);
  const focalSportsHist = focalSportsFromText(focalText);
  const withinFocalHorizon = (startsAt?: string | null) => {
    if (!startsAt) return false;
    const t = Date.parse(startsAt);
    if (!Number.isFinite(t)) return false;
    const now = Date.now();
    return t > now - 4 * 3600_000 && t < now + 8 * 24 * 3600_000;
  };
  sports.forEach((sport, i) => {
    for (const g of oddsAll[i]) {
      // Pregame-only: a game that has already started carries a FROZEN pregame
      // line here (mobile has no live odds feed / live dead-market guard), so
      // recommending a bet off it would be dishonest. Slate screens still show
      // in-progress games via isPickable; the coach pool must not.
      if (!isPregameBettable(g.commenceTime)) continue;
      if (todayOnly && !startsTodayUpcoming(g.commenceTime)) continue;
      realOdds.push(...buildRealOdds(g, oddsThreshold, includePeriods, altSign));
    }
    const sportFocal = focalSportsHist.has(sport);
    let perSport = 0;
    let focalExtra = 0;
    for (const g of gamesAll[i]) {
      if (g.state === "post") continue; // finished
      const away = g.awayTeam || g.awayAbbr || "";
      const home = g.homeTeam || g.homeAbbr || "";
      if (!away || !home) continue;
      const gameLabel = `${away} @ ${home}`;
      let included = isPickable(g.startsAt) && (!todayOnly || startsTodayUpcoming(g.startsAt));
      if (!included && !todayOnly) {
        // Series-lookahead widening: only for the named sport/game, only a few
        // games out, capped (focalExtra) so a focal MLB ask can't drag in a
        // week of baseball. These extra games carry no odds — they exist purely
        // so the coach can do the matchup / last-meeting read for them. A
        // today-only ask never widens — it stays on today's upcoming slate.
        const isFocalGame = sportFocal || gameMatchesFocalText(gameLabel, focalText);
        if (isFocalGame && withinFocalHorizon(g.startsAt) && focalExtra < 6) {
          included = true;
          focalExtra++;
        }
      }
      if (!included) continue;
      realGames.push({
        sport,
        game: gameLabel,
        status: g.status,
        startsAt: g.startsAt,
        venue: g.venue ?? null,
      });
      // Real injury read for this matchup (key players out + deterministic edge),
      // joined from the per-sport ESPN report. Null when neither side has a
      // betting-relevant injury, so it never adds noise to the context.
      const injReport = buildGameInjuryReport(sport, injuriesAll[i], away, home);
      if (injReport) matchupInjuries[gameLabel] = injReport;
      if (g.homeTeamId && g.awayTeamId && perSport < 12) {
        historyTargets.push({ sport, gameLabel, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, startsAt: g.startsAt });
        perSport++;
      }
    }
  });

  // Real prior-matchup analytics (+ mlLean winner & upset) for the pickable pool,
  // joined against the real moneyline prices in realOdds. Same engine + endpoint
  // as the web app, so the coach weighs the same signals on both platforms.
  const { matchupHistory, upsetSpots } = await buildMatchupHistoryAndUpsets(
    historyTargets,
    buildMlPriceByLabel(realOdds),
    signal,
    focalText,
    depth.matchup,
  );

  // UFC FIGHT ANALYSIS: real ESPN fighter records + career striking/grappling
  // rates + a deterministic stronger-fighter lean for each pickable UFC bout.
  // Combat sports are moneyline-only — this is the one analytics layer we can
  // build for them. A fight UPSET = the data-favored fighter (lean.side) is ALSO
  // the BETTING UNDERDOG (the plus-money side in the real h2h pool); joined
  // against the raw moneyline outcomes (full fighter names), never fabricated.
  const fightAnalysis: Record<string, FightAnalysis> = {};
  const ufcIdx = sports.indexOf("ufc");
  if (ufcIdx >= 0) {
    const ufcGames = gamesAll[ufcIdx]
      .filter((g) => g.state !== "post" && isPickable(g.startsAt) && (g.awayTeam || g.awayAbbr) && (g.homeTeam || g.homeAbbr))
      .slice(0, 12);
    const ufcOdds = oddsAll[ufcIdx];
    await Promise.all(
      ufcGames.map(async (g) => {
        const away = g.awayTeam || g.awayAbbr || "";
        const home = g.homeTeam || g.homeAbbr || "";
        const gameLabel = `${away} @ ${home}`;
        const data = await getFightAnalysis(away, home, signal);
        // Skip honest-empty bouts (neither fighter resolved + no lean).
        if (!data || (!data.away?.record && !data.home?.record && !data.lean)) return;
        if (data.lean?.side) {
          const oddsEntry = ufcOdds.find((o) => o.awayTeam === away && o.homeTeam === home);
          const h2h = oddsEntry?.markets?.find((m) => m.key === "h2h");
          // Normalize accents/punctuation/spacing: lean.side is ESPN's canonical
          // name, the h2h outcome name comes from the odds feed — an exact ===
          // would silently miss real upsets when the two forms diverge.
          const nf = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
          const out = (h2h?.outcomes || []).find((o) => nf(o.name) === nf(data.lean!.side));
          if (out && typeof out.price === "number" && out.price >= 100) {
            data.lean.upset = { dogOdds: out.price };
          }
        }
        fightAnalysis[gameLabel] = data;
      }),
    );
  }

  // Assemble a REAL player-prop pool from the soonest prop-capable games so the
  // AI can build prop legs (and never fabricate them). PROPS_SPORTS only. Soccer
  // IS prop-capable but only for FIFA World Cup games (goalscorer/shots/SoT);
  // club leagues + tennis/ufc return nothing. A failed/empty per-game fetch just
  // narrows the pool; it never invents props.
  const propCandidates: { sport: string; g: OddsGame; ids: PropTeamIds | null }[] = [];
  sports.forEach((sport, i) => {
    if (!PROPS_SPORTS.includes(sport)) return;
    const idMap = buildPropIdMap(gamesAll[i]);
    for (const g of oddsAll[i]) {
      // Pregame-only (same honesty rule as realOdds above): never seed coach
      // prop picks from a game that's already underway with a frozen line.
      if (!isPregameBettable(g.commenceTime)) continue;
      if (todayOnly && !startsTodayUpcoming(g.commenceTime)) continue;
      if (!g.homeTeam || !g.awayTeam) continue;
      const ids = idMap.get(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()) ?? null;
      propCandidates.push({ sport, g, ids });
    }
  });
  propCandidates.sort((a, b) => Date.parse(a.g.commenceTime) - Date.parse(b.g.commenceTime));
  // Focal-priority for the props FETCH window. We only fetch props for the
  // soonest MAX_PROP_CONTEXT_GAMES prop-capable games. On a night with many
  // earlier-starting games from OTHER sports (e.g. ~15 evening MLB games), that
  // window fills up before a later focal slate (e.g. 9pm World Cup soccer) is
  // ever reached — so the focal games get ZERO props fetched and the model can
  // only build game-level legs (moneyline/spread/total). That is exactly why a
  // "soccer parlay" came back as all ML/spread/total despite real soccer props
  // existing upstream. When the user named a sport/game, float that focal slate
  // to the front (still time-sorted within each group) so its props are always
  // fetched first. Mirrors the realProps cap (balancePropsByGame) and the
  // matchup-history focal ordering — those float the CAP, this floats the FETCH.
  if (focalText) {
    const focalSports = focalSportsFromText(focalText);
    const isFocal = (c: { sport: string; g: OddsGame }) =>
      gameMatchesFocalText(`${c.g.awayTeam} @ ${c.g.homeTeam}`, focalText) ||
      focalSports.has(c.sport);
    const focal = propCandidates.filter(isFocal);
    if (focal.length > 0 && focal.length < propCandidates.length) {
      const rest = propCandidates.filter((c) => !isFocal(c));
      propCandidates.length = 0;
      propCandidates.push(...focal, ...rest);
    }
  }

  const realProps: RealPropEntry[] = [];
  // Render-only prop pool (one row per posted side) enriched with the real ESPN
  // headshot + team code. Built here from the raw PlayerProp because the
  // headshot/playerTeamId live on it and are stripped from the lean
  // RealPropEntry we send to the AI.
  const propPool: PropPoolEntry[] = [];
  // Unique prop players to pull real ESPN game logs for (recent form +
  // vs-opponent + home/away split) so the coach can defend a prop with real
  // numbers. opponentTeamId / isHome are resolved per prop from the game's team
  // ids so the server can return the vs-opponent + venue-correct split.
  const playerTargets: {
    sport: string;
    game: string;
    player: string;
    athleteId: string;
    opponentTeamId: string | null;
    isHome: boolean | null;
  }[] = [];
  const seenAthletes = new Set<string>();
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
            // A side must ALSO match an explicit "+ alt" / "- alt" sign ask, so the
            // model only ever sees prop sides on the requested odds sign. Otherwise
            // it picks a wrong-sign prop that the post-parse sign filter then strips,
            // leaving a short ticket (the matchProp cushion/value swap is best-effort
            // and can't always convert). Sign and threshold never co-apply (altSign
            // is only set when there's no threshold), but both gate here uniformly.
            const sideQualifies = (price: number | null | undefined) =>
              price != null &&
              (!oddsThreshold || oddsSatisfiesThreshold(price, oddsThreshold)) &&
              (!altSign || (altSign === "plus" ? price > 0 : price < 0));
            const overQ = sideQualifies(p.overPrice);
            const underQ = sideQualifies(p.underPrice);
            if ((oddsThreshold || altSign) && !overQ && !underQ) continue;
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
              athleteId: p.athleteId ?? null,
              market: p.market,
              line: p.line,
              over: overQ ? p.overPrice : null,
              under: underQ ? p.underPrice : null,
              alt: !!p.alt,
              // Carry the server-computed +EV signal (MAIN lines only) so the
              // chat AI can surface real mispriced/value props on request.
              ev: p.ev ?? null,
              evSide: p.evSide ?? null,
              fairProb: p.fairProb ?? null,
              edge: p.edge ?? null,
            });
            // Collect each unique player once for the game-log / platoon fetch.
            // opponentTeamId + isHome come from the player's team vs the game's
            // home/away ids (null when the mapping is unavailable — the server
            // then skips the vs-opponent / venue split rather than inventing one).
            if (p.athleteId && !seenAthletes.has(p.athleteId)) {
              seenAthletes.add(p.athleteId);
              let oppId: string | null = null;
              let isHome: boolean | null = null;
              if (p.playerTeamId && ids) {
                const pt = String(p.playerTeamId);
                oppId = pt === ids.homeTeamId ? ids.awayTeamId : pt === ids.awayTeamId ? ids.homeTeamId : null;
                isHome = pt === ids.homeTeamId ? true : pt === ids.awayTeamId ? false : null;
              }
              playerTargets.push({ sport, game, player: p.player, athleteId: String(p.athleteId), opponentTeamId: oppId, isHome });
            }
            const headshot = p.headshot ?? null;
            const teamAbbr = p.playerTeamId
              ? (teamMetaById.get(p.playerTeamId)?.abbr ?? null)
              : null;
            const marketLabel = propMarketLabel(p.market);
            const athleteId = p.athleteId ?? null;
            if (overQ) {
              propPool.push({ sport, game, marketLabel, player: p.player, line: p.line, side: "Over", odds: p.overPrice!, headshot, teamAbbr, athleteId, marketKey: p.market, edge: p.evSide === "Over" ? (p.edge ?? null) : null, bookSpread: p.overSpread ?? null });
            }
            if (p.line != null && underQ) {
              propPool.push({ sport, game, marketLabel, player: p.player, line: p.line, side: "Under", odds: p.underPrice!, headshot, teamAbbr, athleteId, marketKey: p.market, edge: p.evSide === "Under" ? (p.edge ?? null) : null, bookSpread: p.underSpread ?? null });
            }
          }
        }
      } catch {
        // skip this game's props — narrower pool, never fabricated
      }
    }),
  );

  // Focus the capped realOdds on the league/game the user actually named so a
  // single-game or single-sport ask (e.g. a Q1 same-game parlay) doesn't get its
  // odds truncated out by other sports that iterate first. Without this, the
  // all-sports pool overflows the cap (MLB's nightly slate alone exceeds it)
  // before the loop reaches a lone NBA game, so its markets are sliced off and
  // the model wrongly reports "no posted realOdds" for that game.
  const focalSports = focalSportsFromText(focalText);
  const oddsRank = (e: RealOddsEntry): number => {
    if (!focalText) return 0;
    if (gameMatchesFocalText(e.game, focalText)) return 2;
    if (focalSports.has(e.sport)) return 1;
    return 0;
  };
  const rankedOdds = focalText
    ? realOdds
        .map((e, i) => ({ e, i, s: oddsRank(e) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.e)
    : realOdds;
  // Period/same-game tickets surface many game-level period legs per game, so the
  // cap is raised when those are included to keep a usable multi-leg pool.
  const ODDS_CAP = includePeriods ? 400 : depth.odds;

  // ---------- Real player game logs + MLB platoon / ballpark signals ----------
  // Mirror of the web ParlayBuilder build: pull each unique prop player's REAL
  // ESPN game log (recent form + vs-opponent + home/away & venue split) so the
  // coach defends a prop with real numbers, not the book price. For MLB we ALSO
  // pull batter handedness vs the opposing probable starter (platoon edge + the
  // batter's real vs-LHP/RHP split), the starter's real season tendency, and the
  // ballpark HR environment. The server auto-builds the batter-vs-pitcher career
  // line from mlbPlatoon.opposingPitcherName. Every field is real feed data —
  // missing pieces stay honest nulls and absent maps are simply omitted.
  const playerHistory: Record<string, unknown> = {};
  // The 40-player cap on game-log fetches can starve the players the user
  // actually asked about. prioritizePlayerHistoryTargets floats the FOCAL
  // game/sport's players to the front first, then MLB (so batter-vs-pitcher
  // platoon coverage stays intact when there's no focal pull), then everyone
  // else, before trimming to the cap. Without the focal float a busy in-season
  // MLB slate fills all 40 slots and an NBA/NFL game the user named gets no
  // recent logs — the coach then truthfully says "no recent log available" even
  // though the server has it. See chatContextPriority.ts (unit-tested).
  const phTargets = prioritizePlayerHistoryTargets(playerTargets, focalText, depth.history);
  if (phTargets.length > 0) {
    type HistWindow = { games?: number; averages?: Record<string, number> };
    type HistResp = {
      recent?: { date?: string; opponentName?: string; stats?: Record<string, unknown> }[];
      vsOpponent?: { date?: string; stats?: Record<string, unknown> }[];
      homeSplit?: { games?: number } | null;
      awaySplit?: { games?: number } | null;
      windows?: { last5?: HistWindow; last10?: HistWindow; last20?: HistWindow } | null;
      minutesTrend?: { l5: number | null; l10: number | null; season: number | null; direction: string } | null;
    };
    await Promise.all(
      phTargets.map(async (t) => {
        try {
          const q = new URLSearchParams({ sport: t.sport, athleteId: t.athleteId });
          if (t.opponentTeamId) q.set("opponentTeamId", t.opponentTeamId);
          const data = await getJson<HistResp>(`/sports/player-history?${q.toString()}`, signal);
          const recent = Array.isArray(data?.recent) ? data.recent.slice(0, 5) : [];
          const vsOpp = Array.isArray(data?.vsOpponent) ? data.vsOpponent.slice(0, 3) : [];
          if (!recent.length && !vsOpp.length) return;
          const homeSplit = data?.homeSplit && (data.homeSplit.games ?? 0) > 0 ? data.homeSplit : null;
          const awaySplit = data?.awaySplit && (data.awaySplit.games ?? 0) > 0 ? data.awaySplit : null;
          const venue = t.isHome === true ? "home" : t.isHome === false ? "away" : null;
          const tonightSplit = venue === "home" ? homeSplit : venue === "away" ? awaySplit : null;
          // Recent-form windows: attach the LONGER L10 / L20 per-stat averages
          // (recent already carries the last 5) so the model can read a current
          // form trend vs the season line. Only keep buckets that have games.
          const win: Record<string, { games: number; averages: Record<string, number> }> = {};
          for (const w of ["last10", "last20"] as const) {
            const b = data?.windows?.[w];
            if (b && (b.games ?? 0) > 0 && b.averages && Object.keys(b.averages).length) {
              win[w] = { games: b.games as number, averages: b.averages };
            }
          }
          playerHistory[`${t.player}#${t.athleteId}`] = {
            player: t.player,
            recent: recent.map((g) => ({ date: g.date, opp: g.opponentName, stats: g.stats })),
            vsOpponent: vsOpp.map((g) => ({ date: g.date, stats: g.stats })),
            ...(homeSplit ? { homeSplit } : {}),
            ...(awaySplit ? { awaySplit } : {}),
            ...(tonightSplit ? { tonightVenue: venue, tonightSplit } : {}),
            ...(Object.keys(win).length ? { windows: win } : {}),
            ...(data?.minutesTrend ? { minutesTrend: data.minutesTrend } : {}),
          };
        } catch {
          /* honest no-history fallback */
        }
      }),
    );
  }

  // Resolve free-form player-name candidates against ESPN and inject their REAL
  // recent game log (recent-form-only) into playerHistory. Shared by the named
  // off-pool form-question enrichment and the analyze-ticket pass below. Every
  // candidate is whole-word + active-player guarded so a stray token or a team
  // name can never bind to an unrelated athlete — players with no real recent log
  // stay absent (honest no-history), never fabricated.
  const enrichRecentForm = async (candidates: string[]) => {
    const uniq = Array.from(new Set(candidates.filter(Boolean))).slice(0, 16);
    if (!uniq.length) return;
    const existingIds = new Set(
      Object.keys(playerHistory)
        .map((k) => k.split("#")[1])
        .filter(Boolean),
    );
    const norm = (s: string) =>
      String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const seenIds = new Set<string>();
    type EnrichResp = {
      recent?: { date?: string; opponentName?: string; stats?: Record<string, unknown> }[];
    };
    await Promise.all(
      uniq.map(async (cand) => {
        try {
          const sr = await searchPlayer(cand, signal);
          const hit = (sr.results || [])[0];
          if (!hit?.athleteId || !hit.name) return;
          // Whole-word guard: every candidate token must be a WHOLE word in the
          // resolved name (accent-insensitive) so a fuzzy ESPN hit can't bind an
          // unrelated player to a stray token.
          const nameToks = norm(hit.name).split(/\s+/).filter(Boolean);
          const candToks = norm(cand).split(/\s+/).filter(Boolean);
          if (!candToks.length || !candToks.every((c) => nameToks.includes(c))) return;
          // Single-token (surname-only) candidates are the highest misbinding
          // risk — many athletes share a surname/first name. Accept one only
          // when the player is ACTIVE and the token IS their first or last name
          // (not a middle-name accident or a retired namesake). Multi-token
          // (first + last) candidates are already specific enough to trust.
          if (candToks.length === 1) {
            const isFirstOrLast =
              candToks[0] === nameToks[0] || candToks[0] === nameToks[nameToks.length - 1];
            if (!hit.isActive || !isFirstOrLast) return;
          }
          const id = String(hit.athleteId);
          if (existingIds.has(id) || seenIds.has(id)) return;
          seenIds.add(id);
          const q = new URLSearchParams({ sport: hit.sport, athleteId: id });
          const data = await getJson<EnrichResp>(`/sports/player-history?${q.toString()}`, signal);
          const recent = Array.isArray(data?.recent) ? data.recent.slice(0, 5) : [];
          if (!recent.length) return;
          playerHistory[`${hit.name}#${id}`] = {
            player: hit.name,
            recentFormOnly: true,
            recent: recent.map((g) => ({ date: g.date, opp: g.opponentName, stats: g.stats })),
          };
        } catch {
          /* honest no-history fallback — skip this name */
        }
      }),
    );
  };

  if (focalText && focalText.trim()) {
    const ftLow = focalText.toLowerCase();
    const isBuild =
      /\b(parlay|build|wager|slip|legs?|sgp|same game|alt|alternate|alternates|pick'?em|moneyline|spread)\b/.test(
        ftLow,
      ) || /\b\d+\s*[- ]?legs?\b/.test(ftLow);
    const hasFormCue =
      /\b(home runs?|homers?|homer|hr|hitting|hits|form|recent|lately|last \d+ games?|game ?log|projection|project|going deep|xbh|slug|slugging|streak|do you (?:like|rate|think)|thoughts on|read on)\b/.test(
        ftLow,
      );
    if (!isBuild && hasFormCue) {
      await enrichRecentForm(extractNamedCandidates(focalText).slice(0, 6));
    }
  }

  // Analyze-the-ticket enrichment. A read-only slip critique grades each leg the
  // coach itself picked, but a deep same-game ticket's prop players are usually
  // NOT in tonight's capped/balanced prop pool (or its game-log targets), so
  // without this the coach would honestly-but-uselessly say "no game log in my
  // feed" for a leg it just built. Pull each slip PROP player's REAL recent game
  // log so the analysis can validate the posted number against actual production.
  // Game-level legs (ML / spread / total) yield no player and are skipped; the
  // shared whole-word / active guard refuses team names, so nothing is fabricated.
  if (analyzeSlip && currentSlip.length) {
    const slipNames = currentSlip
      .map((leg) => slipPropPlayerName(leg.pick))
      .filter((n): n is string => !!n);
    await enrichRecentForm(slipNames);
  }

  // MLB platoon (batter hand vs opposing probable starter) + per-game ballpark
  // environment. One /mlb-probables fetch (park + weather + each starter's real
  // tendency) plus a per-batter vs-LHP/RHP split fetch. Same maps + keys as web.
  const mlbPlatoon: Record<string, unknown> = {};
  const mlbGameEnv: Record<string, unknown> = {};
  const mlbTargets = phTargets.filter((t) => t.sport === "mlb");
  if (mlbTargets.length > 0) {
    type Probable = { name?: string; throws?: string | null; tendency?: unknown };
    type ProbGame = {
      venue?: string | null;
      park?: { hrIndex?: number; altitudeFt?: number; dome?: boolean } | null;
      weather?: unknown;
    };
    let probables: Record<string, Probable> = {};
    let probablesGames: Record<string, ProbGame> = {};
    try {
      const pdata = await getJson<{ probables?: Record<string, Probable>; games?: Record<string, ProbGame> }>(
        `/sports/mlb-probables`,
        signal,
      );
      probables = pdata?.probables ?? {};
      probablesGames = pdata?.games ?? {};
    } catch {
      /* honest no-probables fallback */
    }
    await Promise.all(
      mlbTargets.map(async (t) => {
        try {
          const data = await getJson<{ bats?: string | null; vsLeft?: unknown; vsRight?: unknown }>(
            `/sports/mlb-batter-splits?athleteId=${encodeURIComponent(t.athleteId)}`,
            signal,
          );
          const bats = data?.bats || null;
          const oppPitcher = (t.opponentTeamId ? probables[t.opponentTeamId] : null) || null;
          const oppThrows = oppPitcher?.throws || null;
          let platoon: string | null = null;
          if (bats === "Switch") platoon = "switch";
          else if (bats && oppThrows) platoon = bats !== oppThrows ? "advantage" : "disadvantage";
          const vsThatHand = oppThrows === "Left" ? data?.vsLeft : oppThrows === "Right" ? data?.vsRight : null;
          if (!bats && !oppThrows && !data?.vsLeft && !data?.vsRight) return;
          mlbPlatoon[`${t.player}#${t.athleteId}`] = {
            player: t.player,
            bats,
            opposingPitcherName: oppPitcher?.name || null,
            opposingPitcherThrows: oppThrows,
            opposingPitcherTendency: oppPitcher?.tendency || null,
            platoon,
            vsThatHand: vsThatHand || null,
            vsLeft: data?.vsLeft || null,
            vsRight: data?.vsRight || null,
          };
        } catch {
          /* honest no-platoon fallback */
        }
      }),
    );
    // Per-game ballpark environment for every MLB game in the pool. Built from
    // the ESPN games list (which carries the team ids realGames omits), keyed by
    // the same "Away @ Home" label as realProps so the model can join them.
    for (let i = 0; i < sports.length; i++) {
      if (sports[i] !== "mlb") continue;
      for (const g of gamesAll[i]) {
        if (!g.homeTeamId || !g.homeTeam || !g.awayTeam) continue;
        const env = probablesGames[g.homeTeamId] ?? null;
        const home = probables[g.homeTeamId] ?? null;
        const away = g.awayTeamId ? (probables[g.awayTeamId] ?? null) : null;
        if (!env && !home && !away) continue;
        const dome = env?.park?.dome === true;
        mlbGameEnv[`${g.awayTeam} @ ${g.homeTeam}`] = {
          venue: env?.venue ?? g.venue ?? null,
          park: env?.park ?? null,
          weather: dome ? null : (env?.weather ?? null),
          ...(dome ? { climateControlled: true } : {}),
          homePitcher: home ? { name: home.name ?? null, throws: home.throws ?? null, tendency: home.tendency ?? null } : null,
          awayPitcher: away ? { name: away.name ?? null, throws: away.throws ?? null, tendency: away.tendency ?? null } : null,
        };
      }
    }
  }

  return {
    context: {
      selectedSports: sports,
      currentSlip,
      realGames: realGames.slice(0, 60),
      realOdds: rankedOdds.slice(0, ODDS_CAP),
      realProps: balancePropsByGame(realProps, depth.props, focalText),
      ...(Object.keys(matchupHistory).length ? { matchupHistory } : {}),
      ...(Object.keys(fightAnalysis).length ? { fightAnalysis } : {}),
      ...(Object.keys(playerHistory).length ? { playerHistory } : {}),
      ...(Object.keys(mlbPlatoon).length ? { mlbPlatoon } : {}),
      ...(Object.keys(mlbGameEnv).length ? { mlbGameEnv } : {}),
      ...(Object.keys(matchupInjuries).length ? { matchupInjuries } : {}),
    },
    propPool,
    gameMeta,
    upsetSpots,
    todayOnly,
  };
}

// ---------- Chat streaming (SSE over POST) ----------

export type StreamChatArgs = {
  messages: ChatMessage[];
  context: ChatContext;
  onToken: (full: string) => void;
  signal?: AbortSignal;
  // Optional base64 data URL of a user-attached photo (bet slip / screenshot).
  // Forwarded to the server, which attaches it to the latest user turn for the
  // vision model to read. Legacy single-image field.
  imageDataUrl?: string | null;
  // Optional list (max 3) of base64 data URLs of user-attached photos. Preferred
  // over the singular imageDataUrl; the server caps and validates these.
  imageDataUrls?: string[];
  // Optional callback fired with the EXACT player-prop pool the server fed the
  // model (the post-filter / post-backfill realProps). The client's own prop pool
  // is capped to the soonest games and can miss late-starting games (or drop them
  // on a burst-429), so the model can correctly pick a real prop the client never
  // fetched. Merging this server pool into the client propPool lets parsePicks
  // resolve those legs instead of fail-closing the whole ticket. Real bookmaker
  // data only — never fabricated.
  onProps?: (props: RealPropEntry[]) => void;
  // Background-finish opt-in (AI Coach). When true the server keeps generating
  // the reply even if this phone disconnects (app backgrounded / left the
  // screen), stashes the finished ticket under the signed-in user's account,
  // and fires a push. `buildId` ties that stash back to the local context the
  // client saved so the same pick cards can be rebuilt on return.
  notifyOnBackground?: boolean;
  buildId?: string;
};

// Convert the server's realProps (one row per player+market with both posted
// sides) into resolution-shape PropPoolEntry rows (one per posted side) so they
// can be merged into the client propPool the slip parser matches against. Render
// metadata (headshot/teamAbbr) is unavailable for server-only rows, so the card
// just renders without a photo — never fabricated. Used to backfill late-game /
// dropped props the client never fetched (see streamChat onProps).
export function propPoolFromRealProps(props: RealPropEntry[]): PropPoolEntry[] {
  const out: PropPoolEntry[] = [];
  for (const p of props) {
    const marketLabel = propMarketLabel(p.market);
    const athleteId = p.athleteId ?? null;
    if (p.over != null) {
      out.push({ sport: p.sport, game: p.game, marketLabel, player: p.player, line: p.line, side: "Over", odds: p.over, athleteId, marketKey: p.market, startsAt: p.startsAt });
    }
    if (p.line != null && p.under != null) {
      out.push({ sport: p.sport, game: p.game, marketLabel, player: p.player, line: p.line, side: "Under", odds: p.under, athleteId, marketKey: p.market, startsAt: p.startsAt });
    }
  }
  return out;
}

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
export async function streamChat({ messages, context, onToken, signal, imageDataUrl, imageDataUrls, onProps, notifyOnBackground, buildId }: StreamChatArgs): Promise<string> {
  // Attach the Clerk bearer token so the server can identify the user. This is
  // required for the background-finish path (it stashes the result + pushes
  // under the account); harmless for normal chats. Resolved once up front.
  let authToken: string | null = null;
  try {
    authToken = authTokenGetter ? await authTokenGetter() : null;
  } catch {
    authToken = null;
  }
  // Max gap between chunks AFTER the first content token. Once the model is
  // streaming, the proxy is in pass-through and frames (real tokens + ~400ms
  // keep-alive pings) flow in real-time, so a multi-second gap then genuinely
  // means a dropped link.
  const STALL_MS = 4000;
  // Max wait for the FIRST content token (the read phase BEFORE any tokens). The
  // Replit path-based proxy BUFFERS the entire SSE response — status frame, the
  // resolved props frame, AND every keep-alive ping — and only flushes to the
  // client once the upstream reasoning model emits its first real content. So
  // during the model's silent time-to-first-token window the client receives
  // ZERO bytes no matter how often the server pings (verified on the wire: an
  // ~8.5s status→first-content silence on a 200KB context, longer on a big
  // multi-leg build). A 4s stall watchdog therefore tripped on EVERY attempt
  // before the build could even start, and each retry hit the identical silence
  // → exhaustion → "I lost the connection while building your ticket". We give
  // the pre-content phase a generous ceiling that covers worst-case reasoning +
  // proxy buffering; a genuinely dead link still aborts and retries, just later.
  // Once the first token lands the proxy switches to pass-through and we tighten
  // back to STALL_MS for the rest of the stream.
  const FIRST_TOKEN_MS = 45000;
  // The POST body is identical on every attempt, so serialize it ONCE up front
  // (re-stringifying a ~130KB+ build context on each retry is pure waste) and
  // reuse the same string below.
  const bodyStr = JSON.stringify({ messages, context, imageDataUrl, imageDataUrls, notifyOnBackground, buildId });
  const bodyKB = bodyStr.length / 1024;
  // Max wait for response HEADERS. This must cover the time to UPLOAD the POST
  // body AND the server's time-to-first-byte. The body is NOT small for a build:
  // production logs show a multi-leg "tonight" context serializes to ~130KB and a
  // full 11+ leg slate to ~500KB. On a weak uplink (the reported failures were on
  // a 1-bar 5G/LTE device) a flat 12s ceiling can't push 130KB+ before it trips,
  // so EVERY attempt connect-stalled before the body finished uploading and we
  // re-POSTed the identical payload 3-5× → exhaustion → "I lost the connection
  // while building your ticket" (verified on the wire: the same contextChars POST
  // repeated back-to-back). So scale the connect budget to the actual body size:
  // a 12s floor for normal chats, plus headroom for big build bodies, capped so a
  // genuinely dead link still aborts in reasonable time (the background-build path
  // is the safety net if we do give up). ~120ms/KB over a 40KB floor ≈ tolerates a
  // ~70kbps uplink: 130KB→~23s, 500KB→capped 30s; a 5KB chat stays at 12s.
  const CONNECT_MS = Math.min(30000, Math.max(12000, Math.round(12000 + Math.max(0, bodyKB - 40) * 120)));
  const MAX_ATTEMPTS = 5;

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
            headers: {
              "Content-Type": "application/json",
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: bodyStr,
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
      // ping) arrives within the read budget the link is dead — we abort to free
      // the socket and bail to the retry logic WITHOUT waiting on the (possibly hung)
      // read. The budget is two-phase: BEFORE the first content token the proxy
      // buffers everything (even keep-alive pings) until the model starts, so the
      // client legitimately receives nothing for the model's whole time-to-first-
      // token — we wait up to FIRST_TOKEN_MS. AFTER the first token the proxy is
      // in pass-through and frames flow in real-time, so a STALL_MS gap then
      // unambiguously means a dropped connection.
      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const readBudget = sawContent ? STALL_MS : FIRST_TOKEN_MS;
        const stall = new Promise<typeof STALL>((resolve) => {
          stallTimer = setTimeout(() => resolve(STALL), readBudget);
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
            } else if (Array.isArray(data.props) && onProps) {
              // The server's resolved prop pool (post-filter / post-backfill).
              // Arrives BEFORE the first content token so the caller can merge it
              // into its propPool before parsePicks runs on the streamed text.
              try { onProps(data.props as RealPropEntry[]); } catch { /* never break the stream on a merge error */ }
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
      // Brief backoff before the next attempt. Without it all attempts fired
      // back-to-back in a few milliseconds, so a transient blip (a weak-LTE
      // packet gap, a momentarily overloaded proxy) burned EVERY attempt before
      // the link had a chance to recover — surfacing as the "couldn't reach the
      // feed" failure on a connection that was only briefly degraded. Growing
      // delay (0.4s → 0.8s → 1.6s → capped 2s), abort-aware so a user cancel
      // still exits immediately, and skipped after the final attempt.
      if (attempt < MAX_ATTEMPTS - 1) {
        const backoffMs = Math.min(2000, 400 * 2 ** attempt);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, backoffMs);
          if (signal) signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
        if (signal?.aborted) throw abortError();
      }
    }
  }

  throw lastErr ?? new Error("chat stream failed");
}
