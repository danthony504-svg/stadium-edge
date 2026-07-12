import { asc, eq, inArray } from "drizzle-orm";
import { db, liveStealsTable } from "@workspace/db";
import { gradeLegs, type GradeLeg } from "../routes/grade";
import {
  findGameSteals,
  findPropSteals,
  findNearMissGameSteals,
  findNearMissPropSteals,
  nearTerm,
  FRESH_TTL_MS,
  GIVE_UP_MS,
  MAX_PROP_GAMES,
  MAX_STEALS,
  PROP_STEAL_SPORTS,
  STEAL_SPORTS,
  tallyGameScan,
  tallyPropScan,
  buildScanMeta,
  seasonStatsFromGraded,
  type FeedProp,
  type OddsRow,
  type PropGame,
  type Steal,
  type StealScanMeta,
  type NearMissSteal,
} from "./liveStealsCore";

// ───────────────────────────────────────────────────────────────────────────
// "+500 Steals" — IMPURE layer: loopback fetch (reusing the app's cached routes),
// persistence (the W/L ledger), grading (shared gradeLegs), and the cron entry.
// All the pure steal-finding / pricing logic lives in liveStealsCore.ts so it is
// unit-testable; everything here touches the db / network / real-result grader.
// ───────────────────────────────────────────────────────────────────────────

// Re-export the pure bits so existing importers (route, tests) keep working.
export {
  inStealBand,
  evPct,
  stealKey,
  findGameSteals,
  findPropSteals,
  type Steal,
  type StealScanMeta,
  type NearMissSteal,
} from "./liveStealsCore";

// ── loopback fetch (reuse cached app routes; bypasses external quota) ────────
const SPORT_FETCH_CONCURRENCY = 2;
const PROPS_FETCH_CONCURRENCY = 3;
const LOOPBACK_TIMEOUT_MS = 55_000;
const EMPTY_SCAN_BACKOFF_MS = 20_000;

function apiBase(): string {
  const port = process.env["PORT"];
  if (!port) return "http://127.0.0.1:8080/api";
  return `http://127.0.0.1:${port}/api`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loopbackGet<T>(path: string, attempts = 3): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOOPBACK_TIMEOUT_MS);
    try {
      const r = await fetch(`${apiBase()}${path}`, {
        headers: { "x-internal-call": "1" },
        signal: ctrl.signal,
      });
      if (r.ok) return (await r.json()) as T;
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || i === attempts - 1) {
        await r.text().catch(() => {});
        return null;
      }
      await r.text().catch(() => {});
    } catch {
      if (i === attempts - 1) return null;
    } finally {
      clearTimeout(timer);
    }
    await sleep(300 * 2 ** i + Math.floor(Math.random() * 150));
  }
  return null;
}

async function pooledMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// Scan the slate for steals (cached FRESH_TTL_MS). Game-line steals are cheap
// (one cached odds call per sport); prop steals fan out per-event and are
// bounded to the soonest MAX_PROP_GAMES games across all prop sports.
let freshCache: {
  at: number;
  steals: Steal[];
  meta: StealScanMeta;
  almostQualified: NearMissSteal[];
} | null = null;
let emptyScanUntil = 0;

export type LiveStealsPayload = {
  steals: Steal[];
  meta: StealScanMeta;
  almostQualified: NearMissSteal[];
};

export async function fetchStealsWithMeta(): Promise<LiveStealsPayload> {
  if (freshCache && Date.now() - freshCache.at < FRESH_TTL_MS) {
    return {
      steals: freshCache.steals,
      meta: freshCache.meta,
      almostQualified: freshCache.almostQualified,
    };
  }
  if (emptyScanUntil > Date.now() && freshCache) {
    return {
      steals: freshCache.steals,
      meta: freshCache.meta,
      almostQualified: freshCache.almostQualified,
    };
  }
  const now = Date.now();

  const oddsPairs = await pooledMap(STEAL_SPORTS, SPORT_FETCH_CONCURRENCY, async (sport) => {
    const rows = await loopbackGet<OddsRow[]>(`/sports/odds?sport=${sport}`);
    return { sport, rows: Array.isArray(rows) ? rows.filter((g) => nearTerm(g.commenceTime, now)) : [] };
  });
  const oddsBySport = new Map<string, OddsRow[]>();
  for (const { sport, rows } of oddsPairs) {
    if (rows.length > 0) oddsBySport.set(sport, rows);
  }

  const bookSet = new Set<string>();
  let marketsChecked = 0;
  let longshotsAnalyzed = 0;
  for (const rows of oddsBySport.values()) {
    const tally = tallyGameScan(rows);
    marketsChecked += tally.marketsChecked;
    longshotsAnalyzed += tally.longshotsAnalyzed;
    for (const b of tally.books) bookSet.add(b);
  }

  const gameSteals: Steal[] = [];
  const nearGame: NearMissSteal[] = [];
  for (const rows of oddsBySport.values()) {
    gameSteals.push(...findGameSteals(rows));
    nearGame.push(...findNearMissGameSteals(rows));
  }

  type Cand = { sport: string; g: OddsRow };
  const cands: Cand[] = [];
  for (const sport of PROP_STEAL_SPORTS) {
    for (const g of oddsBySport.get(sport) ?? []) cands.push({ sport, g });
  }
  cands.sort((a, b) => Date.parse(a.g.commenceTime) - Date.parse(b.g.commenceTime));
  const propGames = await pooledMap(cands.slice(0, MAX_PROP_GAMES), PROPS_FETCH_CONCURRENCY, async ({ sport, g }) => {
    const q = new URLSearchParams({ sport, eventId: g.id, home: g.homeTeam, away: g.awayTeam });
    const r = await loopbackGet<{ props?: FeedProp[] }>(`/sports/props?${q.toString()}`);
    return {
      eventId: g.id,
      game: `${g.awayTeam} @ ${g.homeTeam}`,
      sport,
      startsAt: g.commenceTime,
      props: r?.props ?? [],
    } satisfies PropGame;
  });
  const propTally = tallyPropScan(propGames);
  marketsChecked += propTally.marketsChecked;
  longshotsAnalyzed += propTally.longshotsAnalyzed;

  const propSteals = findPropSteals(propGames);
  const nearProp = findNearMissPropSteals(propGames);

  const byId = new Map<string, Steal>();
  for (const s of [...gameSteals, ...propSteals]) {
    const prev = byId.get(s.id);
    if (!prev || (s.ev ?? 0) > (prev.ev ?? 0)) byId.set(s.id, s);
  }
  const steals = Array.from(byId.values())
    .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))
    .slice(0, MAX_STEALS);

  const nearById = new Map<string, NearMissSteal>();
  for (const s of [...nearGame, ...nearProp]) {
    if (byId.has(s.id)) continue;
    const prev = nearById.get(s.id);
    if (!prev || (s.ev ?? 0) > (prev.ev ?? 0)) nearById.set(s.id, s);
  }
  const almostQualified = Array.from(nearById.values())
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
    .slice(0, 12);

  const booksScanned = bookSet.size;
  const meta = buildScanMeta(steals, almostQualified, {
    marketsChecked,
    longshotsAnalyzed,
    booksScanned,
  });

  const payload = { steals, meta, almostQualified };
  freshCache = { at: Date.now(), ...payload };
  if (marketsChecked > 0 || steals.length > 0) {
    emptyScanUntil = 0;
  } else {
    emptyScanUntil = Date.now() + EMPTY_SCAN_BACKOFF_MS;
  }
  return payload;
}

export async function fetchSteals(): Promise<Steal[]> {
  const { steals } = await fetchStealsWithMeta();
  return steals;
}

// Capture each freshly-seen steal ONCE (onConflictDoNothing keeps the original
// captured price/edge and never disturbs an already-graded row).
export async function persistSteals(steals: Steal[]): Promise<void> {
  if (steals.length === 0) return;
  await db
    .insert(liveStealsTable)
    .values(
      steals.map((s) => ({
        id: s.id,
        sport: s.sport,
        game: s.game,
        market: s.market,
        pick: s.pick,
        player: s.player,
        price: s.price,
        edge: s.edge,
        ev: s.ev,
        fairProb: s.fairProb,
        startsAt: s.startsAt ? new Date(s.startsAt) : null,
        status: "pending",
      })),
    )
    .onConflictDoNothing({ target: liveStealsTable.id });
}

// Settle pending steals whose game has started, using the SAME real-result
// grader as the rest of the app. Terminal results (win/loss/push) are written;
// "ungraded" rows stay pending (retried) until aged out past GIVE_UP_MS.
export async function gradePending(): Promise<void> {
  const now = Date.now();
  const pending = await db
    .select()
    .from(liveStealsTable)
    .where(eq(liveStealsTable.status, "pending"))
    .orderBy(asc(liveStealsTable.startsAt))
    .limit(40);
  const ready = pending.filter((r) => r.startsAt != null && r.startsAt.getTime() < now);
  if (ready.length === 0) return;

  const legs: GradeLeg[] = ready.map((r) => ({
    game: r.game,
    market: r.market,
    pick: r.pick,
    sport: r.sport,
    odds: r.price,
    startsAt: r.startsAt ? r.startsAt.toISOString() : undefined,
  }));
  const results = await gradeLegs(legs);

  const nowDate = new Date();
  await Promise.all(
    results.map(async (res, i) => {
      const row = ready[i];
      if (res.result === "win" || res.result === "loss" || res.result === "push") {
        await db
          .update(liveStealsTable)
          .set({ status: res.result, gradedAt: nowDate })
          .where(eq(liveStealsTable.id, row.id));
      } else if (row.startsAt && now - row.startsAt.getTime() > GIVE_UP_MS) {
        await db
          .update(liveStealsTable)
          .set({ status: "ungraded", gradedAt: nowDate })
          .where(eq(liveStealsTable.id, row.id));
      }
      // else: leave pending (game may not be final yet / stat-log lag).
    }),
  );
}

export type StealRecord = {
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  ungraded: number;
  graded: number;
};

export async function getRecord(): Promise<StealRecord> {
  const rows = await db
    .select({ status: liveStealsTable.status })
    .from(liveStealsTable);
  const rec: StealRecord = { wins: 0, losses: 0, pushes: 0, pending: 0, ungraded: 0, graded: 0 };
  for (const r of rows) {
    if (r.status === "win") rec.wins++;
    else if (r.status === "loss") rec.losses++;
    else if (r.status === "push") rec.pushes++;
    else if (r.status === "ungraded") rec.ungraded++;
    else rec.pending++;
  }
  rec.graded = rec.wins + rec.losses + rec.pushes;
  return rec;
}

const TERMINAL_STATUSES = ["win", "loss", "push"] as const;

export type GradedSteal = {
  id: string;
  sport: string;
  game: string;
  market: string;
  pick: string;
  player: string | null;
  price: number;
  status: (typeof TERMINAL_STATUSES)[number];
  gradedAt: string;
};

// Chronological ledger of every settled app pick (win/loss/push). Powers the
// Home performance chart and the full won-picks history screen.
export async function getGradedHistory(limit = 250): Promise<GradedSteal[]> {
  const rows = await db
    .select({
      id: liveStealsTable.id,
      sport: liveStealsTable.sport,
      game: liveStealsTable.game,
      market: liveStealsTable.market,
      pick: liveStealsTable.pick,
      player: liveStealsTable.player,
      price: liveStealsTable.price,
      status: liveStealsTable.status,
      gradedAt: liveStealsTable.gradedAt,
    })
    .from(liveStealsTable)
    .where(inArray(liveStealsTable.status, [...TERMINAL_STATUSES]))
    .orderBy(asc(liveStealsTable.gradedAt))
    .limit(limit);

  return rows
    .filter((r) => r.gradedAt != null)
    .map((r) => ({
      id: r.id,
      sport: r.sport,
      game: r.game,
      market: r.market,
      pick: r.pick,
      player: r.player,
      price: r.price,
      status: r.status as GradedSteal["status"],
      gradedAt: r.gradedAt!.toISOString(),
    }));
}

// Cron entry point (folded into runNotificationJobs): capture + grade. Fail-safe.
export async function runLiveStealsJob(): Promise<void> {
  try {
    const steals = await fetchSteals();
    await persistSteals(steals);
    await gradePending();
  } catch {
    /* never let the steal ledger break the notification cron */
  }
}
