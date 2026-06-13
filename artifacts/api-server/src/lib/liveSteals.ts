import { asc, eq } from "drizzle-orm";
import { db, liveStealsTable } from "@workspace/db";
import { gradeLegs, type GradeLeg } from "../routes/grade";
import {
  findGameSteals,
  findPropSteals,
  nearTerm,
  FRESH_TTL_MS,
  GIVE_UP_MS,
  MAX_PROP_GAMES,
  MAX_STEALS,
  PROP_STEAL_SPORTS,
  STEAL_SPORTS,
  type FeedProp,
  type OddsRow,
  type PropGame,
  type Steal,
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
} from "./liveStealsCore";

// ── loopback fetch (reuse cached app routes; bypasses external quota) ────────
function apiBase(): string {
  const port = process.env["PORT"] || "5000";
  return `http://127.0.0.1:${port}/api`;
}
async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${apiBase()}${path}`, { headers: { "x-internal-call": "1" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// Scan the slate for steals (cached FRESH_TTL_MS). Game-line steals are cheap
// (one cached odds call per sport); prop steals fan out per-event and are
// bounded to the soonest MAX_PROP_GAMES games across all prop sports.
let freshCache: { at: number; steals: Steal[] } | null = null;

export async function fetchSteals(): Promise<Steal[]> {
  if (freshCache && Date.now() - freshCache.at < FRESH_TTL_MS) return freshCache.steals;
  const now = Date.now();

  const oddsBySport = new Map<string, OddsRow[]>();
  await Promise.all(
    STEAL_SPORTS.map(async (sport) => {
      const rows = await fetchJson<OddsRow[]>(`/sports/odds?sport=${sport}`);
      if (Array.isArray(rows)) oddsBySport.set(sport, rows.filter((g) => nearTerm(g.commenceTime, now)));
    }),
  );

  const gameSteals: Steal[] = [];
  for (const rows of oddsBySport.values()) gameSteals.push(...findGameSteals(rows));

  // Pick the soonest prop-capable games across sports, capped, then fan out.
  type Cand = { sport: string; g: OddsRow };
  const cands: Cand[] = [];
  for (const sport of PROP_STEAL_SPORTS) {
    for (const g of oddsBySport.get(sport) ?? []) cands.push({ sport, g });
  }
  cands.sort((a, b) => Date.parse(a.g.commenceTime) - Date.parse(b.g.commenceTime));
  const propGames = await Promise.all(
    cands.slice(0, MAX_PROP_GAMES).map(async ({ sport, g }): Promise<PropGame> => {
      const q = new URLSearchParams({ sport, eventId: g.id, home: g.homeTeam, away: g.awayTeam });
      const r = await fetchJson<{ props?: FeedProp[] }>(`/sports/props?${q.toString()}`);
      return { eventId: g.id, game: `${g.awayTeam} @ ${g.homeTeam}`, sport, startsAt: g.commenceTime, props: r?.props ?? [] };
    }),
  );
  const propSteals = findPropSteals(propGames);

  // Merge, de-dupe by id (keep the higher EV), best EV first, cap.
  const byId = new Map<string, Steal>();
  for (const s of [...gameSteals, ...propSteals]) {
    const prev = byId.get(s.id);
    if (!prev || (s.ev ?? 0) > (prev.ev ?? 0)) byId.set(s.id, s);
  }
  const steals = Array.from(byId.values())
    .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))
    .slice(0, MAX_STEALS);

  freshCache = { at: Date.now(), steals };
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
