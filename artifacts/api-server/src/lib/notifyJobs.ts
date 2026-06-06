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
};

export const DEFAULT_PREFS: Prefs = {
  master: true,
  dailyPicks: true,
  betResults: true,
  oddsMovement: true,
  gameReminders: true,
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
    sent: 0,
  };

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
