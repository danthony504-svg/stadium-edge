import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  userSyncTable,
  pushTokensTable,
  notifLogTable,
  appKvTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendPush, type PushMessage } from "./push";
import { sweepAbandonedCoachBuilds, pruneOldCoachBuilds } from "./coachBuild";
import { runLiveStealsJob } from "./liveSteals";
import {
  findGameLineArbs,
  findGameLineValueBets,
  findPropArbs,
  findPropValueBets,
  type ArbGame,
  type ArbOpportunity,
  type ArbPropGame,
  type ArbPropInput,
  type ValueBet,
} from "./edgeLock";
import {
  CRON_STALE_AFTER_MS,
  deriveCronHealth,
  type CronHeartbeat,
  type CronHealth,
} from "./cronHealth";

export { CRON_STALE_AFTER_MS };
export type { CronHeartbeat, CronHealth };

// -------------------------------------------------------------------------
// All time-based push triggers live here. The API server deploys as AUTOSCALE,
// so a background setInterval can't be trusted to run — instead a Scheduled
// Deployment hits POST /api/notifications/cron every ~15 min and this function
// does the work. Everything is driven by REAL data (ESPN game feed + the Odds
// API, fetched through the server's own cached routes) and fails CLOSED: if a
// saved-slip leg can't be matched to a live game we send nothing for it rather
// than guess. Sends are de-duplicated via notif_log so the same alert is never
// delivered twice no matter how often the cron runs.
// -------------------------------------------------------------------------

export type Prefs = {
  master: boolean;
  dailyPicks: boolean;
  betResults: boolean;
  oddsMovement: boolean;
  gameReminders: boolean;
  upsetAlerts: boolean;
  // Daily "Edge Lock" alert: real guaranteed arbitrage + +EV value bets found
  // on today's near-term board (the same engine the in-app Edge Lock screen runs).
  edgeLockAlerts: boolean;
  // "Your AI Coach finished a parlay you walked away from." Sent from the /chat
  // route (not the cron jobs), but lives here so it's part of the shared Prefs
  // shape and auto-whitelisted by PREF_KEYS in the notifications route.
  coachReady: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  master: true,
  dailyPicks: true,
  betResults: true,
  oddsMovement: true,
  gameReminders: true,
  upsetAlerts: true,
  edgeLockAlerts: true,
  coachReady: true,
};

type Leg = {
  id: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
};
type SavedSlip = {
  id: string;
  createdAt: number;
  legs: Leg[];
  stake: number;
  combinedOdds: number | null;
};

type GameRow = {
  id: string;
  sport: string;
  status: string;
  startsAt: string;
  homeTeam: string | null;
  awayTeam: string | null;
  state: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
};

type OddsOutcome = { name: string; price: number; point: number | null };
type OddsMarket = { key: string; outcomes: OddsOutcome[] };
type OddsRow = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: OddsMarket[];
};

// Hour (UTC) at/after which the once-a-day "your picks are ready" nudge may go
// out — keeps it out of the middle of the night for US users (~noon ET).
const DAILY_HOUR_UTC = 16;
// How soon before kickoff a game-start reminder fires.
const REMINDER_WINDOW_MS = 45 * 60 * 1000;

function apiBase(): string {
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}/api`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${apiBase()}${path}`);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ---- tolerant game/leg matching (fail-closed) ---------------------------
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// A team's most distinctive token is its nickname (usually the last word):
// "Los Angeles Lakers" -> "lakers". Require BOTH teams' nicknames to appear in
// the leg's game string, so we never attach a notification to the wrong game.
function teamToken(team: string | null): string | null {
  if (!team) return null;
  const toks = norm(team)
    .split(" ")
    .filter((t) => t.length >= 3);
  return toks.length ? toks[toks.length - 1]! : null;
}

function gameMatchesLeg(
  legGame: string,
  away: string | null,
  home: string | null,
): boolean {
  const g = norm(legGame);
  const a = teamToken(away);
  const h = teamToken(home);
  if (!a || !h) return false;
  return g.includes(a) && g.includes(h);
}

// ---- per-user storage reads ---------------------------------------------
async function getPrefs(userId: string): Promise<Prefs> {
  const rows = await db
    .select()
    .from(userSyncTable)
    .where(
      and(
        eq(userSyncTable.userId, userId),
        eq(userSyncTable.namespace, "notifPrefs"),
      ),
    )
    .limit(1);
  const stored = (rows[0]?.data as Partial<Prefs> | undefined) ?? {};
  return { ...DEFAULT_PREFS, ...stored };
}

async function getSlips(userId: string): Promise<SavedSlip[]> {
  const rows = await db
    .select()
    .from(userSyncTable)
    .where(
      and(
        eq(userSyncTable.userId, userId),
        eq(userSyncTable.namespace, "savedSlips"),
      ),
    )
    .limit(1);
  const d = rows[0]?.data;
  return Array.isArray(d) ? (d as SavedSlip[]) : [];
}

// ---- dedup + kv ----------------------------------------------------------
// Atomically CLAIM a (user, key) send. Returns true if this is the first time
// (caller should send); false if it was already sent.
async function claimSend(userId: string, dedupeKey: string): Promise<boolean> {
  const inserted = await db
    .insert(notifLogTable)
    .values({ userId, dedupeKey })
    .onConflictDoNothing()
    .returning({ k: notifLogTable.dedupeKey });
  return inserted.length > 0;
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const rows = await db
    .select()
    .from(appKvTable)
    .where(eq(appKvTable.key, key))
    .limit(1);
  return rows[0]?.value as T | undefined;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const now = new Date();
  await db
    .insert(appKvTable)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appKvTable.key, set: { value, updatedAt: now } });
}

// ---- cron heartbeat / health -------------------------------------------
// EVERY time-based feature (reminders, results, odds-move/daily/upset pushes AND
// the abandoned-Coach-build sweeper) depends on the Scheduled Deployment hitting
// POST /api/notifications/cron every ~15 min. If that schedule ever stops firing
// (missing schedule, expired NOTIFY_CRON_KEY, bad deploy) the whole pipeline goes
// dark silently. So at the end of every run we stamp a heartbeat into KV; a
// status endpoint / startup check reads it to notice a stalled schedule instead
// of failing silently.
const CRON_HEARTBEAT_KEY = "cron:heartbeat";

// Stamp the heartbeat after a successful cron run. Fail-safe: a heartbeat write
// must never break the run, and the caller treats a throw as non-fatal.
export async function recordCronHeartbeat(
  summary: Record<string, number>,
): Promise<void> {
  await kvSet(CRON_HEARTBEAT_KEY, {
    at: Date.now(),
    summary,
  } satisfies CronHeartbeat);
}

// Read the heartbeat and derive whether the schedule looks healthy. The actual
// stall-detection logic lives in deriveCronHealth (pure, unit-tested in
// cronHealth.test.ts); this only does the KV read.
export async function getCronHealth(): Promise<CronHealth> {
  const hb = await kvGet<CronHeartbeat>(CRON_HEARTBEAT_KEY);
  return deriveCronHealth(hb, Date.now());
}

// ---- odds snapshot / movement -------------------------------------------
type OddsSnap = {
  mlHome: number | null;
  mlAway: number | null;
  spHome: number | null;
  total: number | null;
};

function snapshotOdds(g: OddsRow): OddsSnap {
  const find = (key: string) => g.markets.find((m) => m.key === key);
  const h2h = find("h2h");
  const spreads = find("spreads");
  const totals = find("totals");
  const priceOf = (m: OddsMarket | undefined, name: string) =>
    m?.outcomes.find((o) => o.name === name)?.price ?? null;
  const pointOf = (m: OddsMarket | undefined, name: string) =>
    m?.outcomes.find((o) => o.name === name)?.point ?? null;
  const over = totals?.outcomes.find((o) => o.name.toLowerCase() === "over");
  return {
    mlHome: priceOf(h2h, g.homeTeam),
    mlAway: priceOf(h2h, g.awayTeam),
    spHome: pointOf(spreads, g.homeTeam),
    total: over?.point ?? null,
  };
}

const fmtAm = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const fmtSp = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// Returns a human movement description + a signature string (so we only
// re-notify when the line genuinely moves to a NEW level, not every tick).
function detectMove(
  prev: OddsSnap,
  cur: OddsSnap,
  g: OddsRow,
): { text: string; sig: string } | null {
  const parts: string[] = [];
  const sigParts: string[] = [];
  if (
    prev.spHome != null &&
    cur.spHome != null &&
    Math.abs(cur.spHome - prev.spHome) >= 1
  ) {
    parts.push(`spread ${fmtSp(prev.spHome)} → ${fmtSp(cur.spHome)}`);
    sigParts.push(`sp${cur.spHome}`);
  }
  if (
    prev.total != null &&
    cur.total != null &&
    Math.abs(cur.total - prev.total) >= 1
  ) {
    parts.push(`total ${prev.total} → ${cur.total}`);
    sigParts.push(`to${cur.total}`);
  }
  if (
    prev.mlHome != null &&
    cur.mlHome != null &&
    Math.abs(cur.mlHome - prev.mlHome) >= 25
  ) {
    parts.push(`${g.homeTeam} ML ${fmtAm(prev.mlHome)} → ${fmtAm(cur.mlHome)}`);
    sigParts.push(`ml${cur.mlHome}`);
  }
  if (!parts.length) return null;
  return { text: parts.join(", "), sig: sigParts.join("_") };
}

// ---- Upset Watch engine (server port of the mobile/web Upset Watch) ---------
// Surfaces real, model-backed underdogs: games where the app's OWN deterministic
// analytics lean (L10 margin + season win% + venue split + streak + H2H) is on
// the BETTING UNDERDOG (the side carrying the longer, plus-money real moneyline).
// Pure ports of computeMlLean / detectUpset so the notification matches what the
// Upset Watch card and the Coach already show. Real data only — never fabricated.

// Team sports where the moneyline-lean engine works (team L10/season/venue/streak
// + a two-way moneyline). Soccer (3-way ML / draws), UFC and tennis are excluded
// because the team-form engine doesn't model them.
const UPSET_SPORTS = ["nba", "wnba", "mlb", "nhl", "nfl", "ncaaf", "ncaab"];
// Cap matchup-history round-trips per daily scan so the ESPN fan-out stays bounded.
const UPSET_FETCH_CAP = 24;
// Only consider games tipping off within this window (pregame upsets only).
const UPSET_WINDOW_MS = 48 * 60 * 60 * 1000;

type UpsetSpot = {
  game: string;
  sport: string;
  side: string;
  dogOdds: number;
  edge: number;
};

const nickname = (full: string) =>
  (full || "").split(/\s+/).filter(Boolean).pop() || full;
const clampLean = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const streakStr = (s: { type?: string; count?: number } | null | undefined) =>
  s && (s.count ?? 0) > 0 ? (s.type === "W" ? s.count! : -s.count!) : 0;

// Verbatim port of the client computeMlLean: deterministic moneyline lean from
// the matchup-history feed. Returns null when the signal is too thin to call.
function computeMlLean(
  label: string,
  d: any,
): { side: string; edge: number } | null {
  const parts = (label || "").split(" @ ");
  const awayNm = (parts[0] || "").trim();
  const homeNm = (parts[1] || "").trim();
  if (!awayNm || !homeNm || !d) return null;
  const h10 = d?.home?.last10,
    a10 = d?.away?.last10;
  const hSeas = d?.home?.season,
    aSeas = d?.away?.season;
  const hVen = d?.home?.homeSplit?.games > 0 ? d.home.homeSplit : null;
  const aVen = d?.away?.awaySplit?.games > 0 ? d.away.awaySplit : null;
  const h2h = d?.h2h?.meetings?.length ? d.h2h : null;
  let edge = 0;
  let any = false;
  if (h10?.avgMargin != null && a10?.avgMargin != null) {
    edge += clampLean((h10.avgMargin - a10.avgMargin) * 1.2, -10, 10);
    any = true;
  }
  if (hSeas?.winPct != null && aSeas?.winPct != null) {
    edge += clampLean((hSeas.winPct - aSeas.winPct) * 15, -8, 8);
    any = true;
  }
  if (hVen?.avgMargin != null && aVen?.avgMargin != null) {
    edge += clampLean((hVen.avgMargin - aVen.avgMargin) * 0.9, -6, 6);
    any = true;
  }
  const sd = streakStr(d?.home?.streak) - streakStr(d?.away?.streak);
  if (sd !== 0) {
    edge += clampLean(sd * 1.2, -5, 5);
    any = true;
  }
  if (h2h) {
    edge += clampLean((h2h.homeWins - h2h.awayWins) * 2, -5, 5);
    any = true;
  }
  if (!any || Math.abs(edge) < 1) return null;
  const homeFav = edge > 0;
  return {
    side: homeFav ? homeNm : awayNm,
    edge: Math.round(Math.abs(edge) * 10) / 10,
  };
}

// Build { "<sport>|Away @ Home" -> { nickname -> americanPrice } } from the bulk
// odds rows' two-way moneyline (h2h) outcomes. The key is sport-namespaced so two
// different sports that happen to share a game label (e.g. the same school in
// NCAAF and NCAAB) can never overwrite each other's prices.
function priceKey(sport: string, label: string): string {
  return `${sport}|${label}`;
}
function buildMlPriceByLabel(
  rows: OddsRow[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const g of rows) {
    const h2h = g.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    const key = priceKey(g.sport, `${g.awayTeam} @ ${g.homeTeam}`);
    const byNick: Record<string, number> = {};
    for (const o of h2h.outcomes) byNick[nickname(o.name)] = o.price;
    if (Object.keys(byNick).length) out[key] = byNick;
  }
  return out;
}

// An upset = the lean's side carries the LONGER (numerically greater) real
// American price AND it is genuine plus-money (>= +100). Real prices only.
function dogOddsForLean(
  side: string,
  pricesByNick: Record<string, number> | undefined,
): number | null {
  if (!pricesByNick) return null;
  const sidePrice = pricesByNick[nickname(side)];
  if (sidePrice == null) return null;
  let oppPrice: number | null = null;
  for (const [nm, pr] of Object.entries(pricesByNick)) {
    if (nm !== nickname(side)) {
      oppPrice = pr;
      break;
    }
  }
  if (oppPrice == null) return null;
  if (sidePrice > oppPrice && sidePrice >= 100) return sidePrice;
  return null;
}

// Scan the slate for real model-backed underdogs. Fetches games + odds for the
// supported team sports, then matchup-history per pregame game (bounded), and
// keeps only the games where the analytics lean is on the betting dog. Returns
// the spots sorted by edge desc — or [] when there are none (honest, never
// fabricated). Bounded ESPN fan-out via UPSET_FETCH_CAP.
async function computeDailyUpsets(): Promise<UpsetSpot[]> {
  const now = Date.now();
  const [gamesBySport, oddsBySport] = await Promise.all([
    Promise.all(
      UPSET_SPORTS.map((sp) =>
        fetchJson<GameRow[]>(`/sports/games?sport=${sp}`).then((r) => r ?? []),
      ),
    ),
    Promise.all(
      UPSET_SPORTS.map((sp) =>
        fetchJson<OddsRow[]>(`/sports/odds?sport=${sp}`).then((r) => r ?? []),
      ),
    ),
  ]);

  const mlPriceByLabel: Record<string, Record<string, number>> = {};
  const targets: {
    sport: string;
    label: string;
    homeTeamId: string;
    awayTeamId: string;
  }[] = [];
  UPSET_SPORTS.forEach((sport, i) => {
    Object.assign(mlPriceByLabel, buildMlPriceByLabel(oddsBySport[i] ?? []));
    for (const g of gamesBySport[i] ?? []) {
      if (g.state === "post") continue;
      if (!g.homeTeam || !g.awayTeam || !g.homeTeamId || !g.awayTeamId) continue;
      const start = new Date(g.startsAt).getTime();
      if (isNaN(start) || start <= now || start - now > UPSET_WINDOW_MS) continue;
      targets.push({
        sport,
        label: `${g.awayTeam} @ ${g.homeTeam}`,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
      });
    }
  });

  // Prefer games that actually have a posted moneyline (so an upset can resolve)
  // before applying the fetch cap.
  targets.sort((a, b) => {
    const aHas = mlPriceByLabel[priceKey(a.sport, a.label)] ? 0 : 1;
    const bHas = mlPriceByLabel[priceKey(b.sport, b.label)] ? 0 : 1;
    return aHas - bHas;
  });

  const spots: UpsetSpot[] = [];
  await Promise.all(
    targets.slice(0, UPSET_FETCH_CAP).map(async (t) => {
      const data = await fetchJson<any>(
        `/sports/matchup-history?sport=${encodeURIComponent(t.sport)}&homeTeamId=${encodeURIComponent(t.homeTeamId)}&awayTeamId=${encodeURIComponent(t.awayTeamId)}`,
      );
      if (!data) return;
      const lean = computeMlLean(t.label, data);
      if (!lean) return;
      const dogOdds = dogOddsForLean(
        lean.side,
        mlPriceByLabel[priceKey(t.sport, t.label)],
      );
      if (dogOdds == null) return;
      spots.push({
        game: t.label,
        sport: t.sport,
        side: lean.side,
        dogOdds,
        edge: lean.edge,
      });
    }),
  );
  spots.sort((a, b) => b.edge - a.edge);
  return spots;
}

// ---- Edge Lock engine (server port of the in-app Edge Lock screen) ----------
// Scans the near-term board for REAL guaranteed arbitrage and +EV value bets via
// the shared edgeLock module, so the daily push reflects exactly what the screen
// shows. Real prices only — empty result is honest, never fabricated.

// Game-line edges (h2h/spreads/totals) are cheap — one cached odds fetch per
// sport — so we scan a broad slate. Prop edges need a per-game props fetch, so
// they're limited to the prop-eligible sports and a small per-sport game cap.
const EDGE_GAME_SPORTS = [
  "mlb",
  "wnba",
  "nba",
  "nhl",
  "nfl",
  "ncaaf",
  "ncaab",
  "soccer",
  "ufc",
  "tennis",
];
const EDGE_PROP_SPORTS = ["mlb", "wnba", "nba", "nhl", "nfl", "ncaaf", "ncaab", "soccer"];
// Only scan imminent games (matches the in-app screen's NEAR_TERM window): books
// post some slates months early and edges days out are stale and unactionable.
const EDGE_NEAR_TERM_MS = 48 * 60 * 60 * 1000;
const EDGE_MAX_PROP_GAMES = 6;

type EdgeScan = {
  arbs: number;
  values: number;
  topArbPct: number | null;
  topValuePct: number | null;
};

function edgeNearTerm(iso: string, now: number): boolean {
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t > now - 4 * 3600_000 && t < now + EDGE_NEAR_TERM_MS;
}

async function computeDailyEdges(): Promise<EdgeScan> {
  const now = Date.now();
  const arbs: ArbOpportunity[] = [];
  const values: ValueBet[] = [];

  // Game-line edges: one (cached) odds fetch per sport, near-term only.
  const oddsBySport = await Promise.all(
    EDGE_GAME_SPORTS.map((sp) =>
      fetchJson<ArbGame[]>(`/sports/odds?sport=${sp}`).then((r) => r ?? []),
    ),
  );
  const nearTermBySport = new Map<string, ArbGame[]>();
  EDGE_GAME_SPORTS.forEach((sp, i) => {
    const nearTerm = (oddsBySport[i] ?? []).filter((g) =>
      edgeNearTerm(g.commenceTime, now),
    );
    nearTermBySport.set(sp, nearTerm);
    arbs.push(...findGameLineArbs(nearTerm));
    values.push(...findGameLineValueBets(nearTerm));
  });

  // Prop edges: bounded per-game props fetch for the prop-eligible sports.
  await Promise.all(
    EDGE_PROP_SPORTS.map(async (sp) => {
      const pickable = (nearTermBySport.get(sp) ?? [])
        .slice()
        .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime))
        .slice(0, EDGE_MAX_PROP_GAMES);
      if (!pickable.length) return;
      const propGames = await Promise.all(
        pickable.map(async (g): Promise<ArbPropGame> => {
          const r = await fetchJson<{ props?: ArbPropInput[] }>(
            `/sports/props?sport=${encodeURIComponent(sp)}&eventId=${encodeURIComponent(g.id)}&home=${encodeURIComponent(g.homeTeam)}&away=${encodeURIComponent(g.awayTeam)}`,
          );
          return {
            game: `${g.awayTeam} @ ${g.homeTeam}`,
            sport: sp,
            startsAt: g.commenceTime,
            props: (r?.props ?? []).filter((p) => !p.alt),
          };
        }),
      );
      arbs.push(...findPropArbs(propGames));
      values.push(...findPropValueBets(propGames));
    }),
  );

  const topArbPct = arbs.length ? Math.max(...arbs.map((a) => a.profitPct)) : null;
  const topValuePct = values.length ? Math.max(...values.map((v) => v.edgePct)) : null;
  return { arbs: arbs.length, values: values.length, topArbPct, topValuePct };
}

const plural = (n: number) => (n === 1 ? "" : "s");

// Honest, screen-anchored copy: the notification points to the live Edge Lock
// screen (the source of truth) rather than promising a specific bet is still up.
function edgeLockBody(scan: EdgeScan): string {
  if (scan.arbs > 0) {
    const arbPart =
      `${scan.arbs} guaranteed arbitrage play${plural(scan.arbs)}` +
      (scan.topArbPct != null ? ` (up to ${scan.topArbPct}% locked profit)` : "");
    const valPart =
      scan.values > 0 ? ` plus ${scan.values} +EV value bet${plural(scan.values)}` : "";
    return `Edge Lock found ${arbPart}${valPart} on today's board — open it before the lines move.`;
  }
  const valPart =
    `${scan.values} +EV value bet${plural(scan.values)}` +
    (scan.topValuePct != null ? ` (up to +${scan.topValuePct}% edge)` : "");
  return `Edge Lock found ${valPart} on today's board. Open Edge Lock for the edges.`;
}

type QueuedItem = {
  userId: string;
  dedupeKey: string;
  msg: Omit<PushMessage, "to">;
};

export async function runNotificationJobs(): Promise<{
  summary: Record<string, number>;
}> {
  const summary: Record<string, number> = {
    users: 0,
    reminders: 0,
    results: 0,
    daily: 0,
    oddsMoves: 0,
    upsets: 0,
    edges: 0,
    sent: 0,
    coachSwept: 0,
    coachPrunedStashes: 0,
    coachPrunedNotif: 0,
  };

  // Close the autoscale gap for background Coach builds FIRST, unconditionally:
  // a TCP drop can kill the /chat handler before any finish-path runs, leaving
  // an in-flight marker but no stash. Finalize any marker older than the
  // deadline as a terminal failure (no picks — honesty) so a returning user
  // always gets a definite outcome. This MUST run independently of the push
  // fan-out below — the early returns for "no tokens" / "no users" would
  // otherwise skip it and re-strand abandoned builds. Self-contained +
  // fail-safe (never throws), so it can't break the rest of the cron run.
  try {
    summary.coachSwept = await sweepAbandonedCoachBuilds(logger);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "notify: coach build sweep failed");
  }

  // Retention: prune terminal background-build bookkeeping (consumed/stale
  // outcome stashes + the unbounded per-build push dedupe rows) once it ages
  // past the retention window, so these tables don't accumulate stale rows.
  // Runs after the sweep — which writes fresh terminal rows — and is itself
  // fail-safe, so it can't break the push fan-out below. Folded into this same
  // cron so no new schedule is needed.
  try {
    const pruned = await pruneOldCoachBuilds(logger);
    summary.coachPrunedStashes = pruned.stashes;
    summary.coachPrunedNotif = pruned.notifLogs;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "notify: coach build prune failed");
  }

  // Capture today's "+500 steals" and grade any that have finished, so the
  // app's own steal track record settles continuously. Not user-specific, so it
  // runs UNCONDITIONALLY (before the no-tokens early return) and is itself
  // fail-safe — it can never break the push fan-out below.
  try {
    await runLiveStealsJob();
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "notify: live steals job failed");
  }

  const tokenRows = await db.select().from(pushTokensTable);
  if (!tokenRows.length) return { summary };

  const tokensByUser = new Map<string, string[]>();
  for (const r of tokenRows) {
    const arr = tokensByUser.get(r.userId) ?? [];
    arr.push(r.token);
    tokensByUser.set(r.userId, arr);
  }
  const userIds = Array.from(tokensByUser.keys());

  // Load each user's prefs + saved slips; collect which sports we must fetch.
  const users: Array<{ uid: string; prefs: Prefs; slips: SavedSlip[] }> = [];
  const neededSports = new Set<string>();
  for (const uid of userIds) {
    try {
      const prefs = await getPrefs(uid);
      if (!prefs.master) continue;
      const slips = await getSlips(uid);
      users.push({ uid, prefs, slips });
      for (const s of slips)
        for (const l of s.legs)
          if (l.sport) neededSports.add(l.sport.toLowerCase());
    } catch (err) {
      logger.warn({ err: (err as Error)?.message, uid }, "notify: user load failed");
    }
  }
  summary.users = users.length;
  if (!users.length) return { summary };

  // Fetch live game data once per needed sport (shared cache via own routes).
  const gamesBySport = new Map<string, GameRow[]>();
  await Promise.all(
    [...neededSports].map(async (sp) => {
      const rows = (await fetchJson<GameRow[]>(`/sports/games?sport=${sp}`)) ?? [];
      gamesBySport.set(sp, rows);
    }),
  );

  // Fail-CLOSED: only resolve a leg to a game when EXACTLY ONE feed game
  // matches. Zero matches (game outside the feed window) or 2+ matches
  // (ambiguous nickname collision, e.g. two "State" teams) both yield null so
  // we never attach a notification to the wrong game.
  const findGameForLeg = (leg: Leg): GameRow | null => {
    const sp = leg.sport?.toLowerCase();
    const rows = sp ? gamesBySport.get(sp) : undefined;
    if (!rows) return null;
    const matches = rows.filter((g) =>
      gameMatchesLeg(leg.game, g.awayTeam, g.homeTeam),
    );
    return matches.length === 1 ? matches[0]! : null;
  };

  const queue: QueuedItem[] = [];
  const now = Date.now();

  // ---- Odds movement (compute moves ONCE globally, then notify) ----------
  // NOTE: matched legs resolve to ESPN game rows, whose ids are a DIFFERENT id
  // space than the Odds API feed. So we can't key moves by game id — instead we
  // store moves with their team names and re-match to each leg the same tolerant
  // (fail-closed) way game reminders do.
  const wantOdds = users.some((u) => u.prefs.oddsMovement);
  const movedGames: Array<{
    away: string;
    home: string;
    text: string;
    sig: string;
  }> = [];
  if (wantOdds) {
    const oddsBySport = new Map<string, OddsRow[]>();
    await Promise.all(
      [...neededSports].map(async (sp) => {
        const rows = (await fetchJson<OddsRow[]>(`/sports/odds?sport=${sp}`)) ?? [];
        oddsBySport.set(sp, rows);
      }),
    );
    for (const rows of oddsBySport.values()) {
      for (const g of rows) {
        try {
          const cur = snapshotOdds(g);
          const key = `oddssnap:${g.id}`;
          const prev = await kvGet<OddsSnap>(key);
          await kvSet(key, cur);
          if (!prev) continue;
          const move = detectMove(prev, cur, g);
          if (move)
            movedGames.push({
              away: g.awayTeam,
              home: g.homeTeam,
              text: move.text,
              sig: move.sig,
            });
        } catch (err) {
          logger.warn(
            { err: (err as Error)?.message, game: g.id },
            "notify: odds snapshot failed",
          );
        }
      }
    }
  }

  // ---- Per-user triggers --------------------------------------------------
  for (const { uid, prefs, slips } of users) {
    // de-dupe within a single user across multiple slips/legs touching one game
    const remindedGames = new Set<string>();
    const movedSeen = new Set<string>();
    for (const slip of slips) {
      const matched = slip.legs.map((l) => findGameForLeg(l));

      // Game-start reminders (per game, once)
      if (prefs.gameReminders) {
        for (let i = 0; i < slip.legs.length; i++) {
          const g = matched[i];
          if (!g || remindedGames.has(g.id)) continue;
          const start = new Date(g.startsAt).getTime();
          if (
            g.state === "pre" &&
            !isNaN(start) &&
            start > now &&
            start - now <= REMINDER_WINDOW_MS
          ) {
            remindedGames.add(g.id);
            queue.push({
              userId: uid,
              dedupeKey: `reminder:${g.id}`,
              msg: {
                title: "🏟️ Starting soon",
                body: `${g.awayTeam} @ ${g.homeTeam} kicks off shortly — you've got a pick on it.`,
                data: { type: "reminder", gameId: g.id },
              },
            });
          }
        }
      }

      // Bet results — all games final. We notify the user to CHECK results; we
      // never assert win/loss (player props can't be graded reliably and the
      // never-fabricate rule forbids guessing).
      if (prefs.betResults && slip.legs.length > 0) {
        const allFound = matched.every((g) => g != null);
        const allFinal =
          allFound && matched.every((g) => g!.state === "post");
        if (allFinal) {
          queue.push({
            userId: uid,
            dedupeKey: `result:${slip.id}`,
            msg: {
              title: "📊 Your slip's games are final",
              body: `All ${slip.legs.length} game${slip.legs.length > 1 ? "s" : ""} in a saved slip have wrapped up — open Stadium Edge to see how it did.`,
              data: { type: "result", slipId: slip.id },
            },
          });
        }
      }

      // Odds movement — match each leg to a moved game by team name (same
      // fail-closed rule: exactly one moved game must match, else skip).
      if (prefs.oddsMovement) {
        for (const leg of slip.legs) {
          const hits = movedGames.filter((m) =>
            gameMatchesLeg(leg.game, m.away, m.home),
          );
          if (hits.length !== 1) continue;
          const move = hits[0]!;
          const gkey = `${norm(move.away)}@${norm(move.home)}`;
          if (movedSeen.has(gkey)) continue;
          movedSeen.add(gkey);
          queue.push({
            userId: uid,
            dedupeKey: `oddsmove:${gkey}:${move.sig}`,
            msg: {
              title: "📈 Line moved",
              body: `${move.away} @ ${move.home}: ${move.text}.`,
              data: { type: "oddsMovement" },
            },
          });
        }
      }
    }

    // Daily AI-picks nudge — once per UTC day, after the morning hour.
    if (prefs.dailyPicks && new Date().getUTCHours() >= DAILY_HOUR_UTC) {
      const today = new Date().toISOString().slice(0, 10);
      queue.push({
        userId: uid,
        dedupeKey: `daily:${today}`,
        msg: {
          title: "🔥 Today's AI picks are ready",
          body: "Open the Coach for today's parlay ideas and best bets.",
          data: { type: "dailyPicks" },
        },
      });
    }
  }

  // ---- Underdog watch — once-a-day, model-backed underdogs ----------------
  // GLOBAL (not slip-driven): scan the whole slate for real upset spots once per
  // day. The expensive ESPN/odds fan-out runs ONCE and is cached in KV for the
  // day so repeated cron ticks reuse it; per-user dedupe (notif_log) still keeps
  // each user to one send. Fail-CLOSED: if there are no real model-backed dogs we
  // store an empty result and send nothing rather than manufacture one.
  const wantUpset = users.some((u) => u.prefs.upsetAlerts);
  if (wantUpset && new Date().getUTCHours() >= DAILY_HOUR_UTC) {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `upsetdaily:${today}`;
    let spots = await kvGet<UpsetSpot[]>(cacheKey);
    if (spots === undefined) {
      try {
        spots = await computeDailyUpsets();
      } catch (err) {
        logger.warn(
          { err: (err as Error)?.message },
          "notify: upset scan failed",
        );
        spots = [];
      }
      await kvSet(cacheKey, spots);
    }
    if (spots && spots.length > 0) {
      const top = spots[0]!;
      const more = spots.length - 1;
      const body =
        `Our model likes ${top.side} (${fmtAm(top.dogOdds)}) as a live underdog today` +
        (more > 0
          ? ` — plus ${more} more upset spot${more > 1 ? "s" : ""}. Open Upset Watch.`
          : `. Open Upset Watch for the full read.`);
      for (const { uid, prefs } of users) {
        if (!prefs.upsetAlerts) continue;
        queue.push({
          userId: uid,
          dedupeKey: `upset:${today}`,
          msg: {
            title: "🐶 Underdog watch",
            body,
            data: { type: "upsetAlert" },
          },
        });
      }
    }
  }

  // ---- Edge Lock — once-a-day real arbitrage + +EV value bets -------------
  // GLOBAL scan of the near-term board for GUARANTEED cross-book arbitrage and
  // +EV value bets (the same engine the in-app Edge Lock screen runs). The
  // per-game prop fan-out is expensive, so the scan runs ONCE per day (KV-cached)
  // and per-user dedupe keeps each user to a single send. Fail-CLOSED: no real
  // edges → store the empty result and send nothing rather than manufacture one.
  const wantEdge = users.some((u) => u.prefs.edgeLockAlerts);
  if (wantEdge && new Date().getUTCHours() >= DAILY_HOUR_UTC) {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `edgelockdaily:${today}`;
    let scan = await kvGet<EdgeScan>(cacheKey);
    if (scan === undefined) {
      try {
        scan = await computeDailyEdges();
      } catch (err) {
        logger.warn(
          { err: (err as Error)?.message },
          "notify: edge-lock scan failed",
        );
        scan = { arbs: 0, values: 0, topArbPct: null, topValuePct: null };
      }
      await kvSet(cacheKey, scan);
    }
    if (scan && (scan.arbs > 0 || scan.values > 0)) {
      const body = edgeLockBody(scan);
      for (const { uid, prefs } of users) {
        if (!prefs.edgeLockAlerts) continue;
        queue.push({
          userId: uid,
          dedupeKey: `edgelock:${today}`,
          msg: {
            title: "🔒 Edge Lock",
            body,
            data: { type: "edgeLock" },
          },
        });
      }
    }
  }

  // ---- Claim (dedupe) then expand to device tokens and send --------------
  const messages: PushMessage[] = [];
  for (const item of queue) {
    let isNew = false;
    try {
      isNew = await claimSend(item.userId, item.dedupeKey);
    } catch (err) {
      logger.warn(
        { err: (err as Error)?.message },
        "notify: claim failed; skipping",
      );
      continue;
    }
    if (!isNew) continue;
    const type = String(item.msg.data?.type ?? "");
    if (type === "reminder") summary.reminders++;
    else if (type === "result") summary.results++;
    else if (type === "dailyPicks") summary.daily++;
    else if (type === "oddsMovement") summary.oddsMoves++;
    else if (type === "upsetAlert") summary.upsets++;
    else if (type === "edgeLock") summary.edges++;
    for (const tok of tokensByUser.get(item.userId) ?? [])
      messages.push({ to: tok, ...item.msg });
  }

  if (messages.length) {
    const { sent, invalidTokens } = await sendPush(messages);
    summary.sent = sent;
    if (invalidTokens.length) {
      await db
        .delete(pushTokensTable)
        .where(inArray(pushTokensTable.token, invalidTokens));
    }
  }

  return { summary };
}

// Send a one-off test push to all of a single user's devices. Used by the
// in-app "Send test notification" button to prove the pipeline end-to-end.
export async function sendTestToUser(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, userId));
  const tokens = rows.map((r) => r.token);
  if (!tokens.length) return 0;
  const { sent, invalidTokens } = await sendPush(
    tokens.map((t) => ({
      to: t,
      title: "Stadium Edge ✅",
      body: "Push notifications are working!",
      data: { type: "test" },
    })),
  );
  if (invalidTokens.length) {
    await db
      .delete(pushTokensTable)
      .where(inArray(pushTokensTable.token, invalidTokens));
  }
  return sent;
}
