import { asc, eq, inArray } from "drizzle-orm";
import { db, liveStealsTable } from "@workspace/db";
import { gradeLegs, type GradeLeg } from "../routes/grade";
import {
  emptyStealFeedDiagnostics,
  StealFeedScanError,
  type StealFeedDiagnostics,
  type StealOddsSportProbe,
} from "./stealFeedDiagnostics.ts";
import {
  failLiveStealsStage,
  liveStealsPipelineFailure,
  liveStealsPipelineStages,
  logLiveStealsStage,
  resetLiveStealsPipelineTrace,
} from "./liveStealsPipelineTrace.ts";
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
  finalizeStealScanStats,
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

export { type StealFeedDiagnostics, type StealOddsSportProbe } from "./stealFeedDiagnostics.ts";

// ── loopback fetch (reuse cached app routes; bypasses external quota) ────────
function apiBase(): string {
  const port = process.env["PORT"] || "5000";
  return `http://127.0.0.1:${port}/api`;
}

type JsonProbe<T> = {
  ok: boolean;
  httpStatus: number;
  responseTimeMs: number;
  data: T | null;
  error?: string;
};

async function probeJson<T>(path: string): Promise<JsonProbe<T>> {
  const started = Date.now();
  try {
    const r = await fetch(`${apiBase()}${path}`, { headers: { "x-internal-call": "1" } });
    const responseTimeMs = Date.now() - started;
    if (!r.ok) {
      let error = `HTTP ${r.status}`;
      try {
        const body = (await r.json()) as { error?: string };
        if (body?.error) error = `${error}: ${body.error}`;
      } catch {
        /* non-json error body */
      }
      return { ok: false, httpStatus: r.status, responseTimeMs, data: null, error };
    }
    const data = (await r.json()) as T;
    return { ok: true, httpStatus: r.status, responseTimeMs, data };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      responseTimeMs: Date.now() - started,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const probe = await probeJson<T>(path);
  return probe.ok ? probe.data : null;
}

// Scan the slate for steals (cached FRESH_TTL_MS). Game-line steals are cheap
// (one cached odds call per sport); prop steals fan out per-event and are
// bounded to the soonest MAX_PROP_GAMES games across all prop sports.
let freshCache: {
  at: number;
  steals: Steal[];
  meta: StealScanMeta;
  almostQualified: NearMissSteal[];
  feed: StealFeedDiagnostics;
} | null = null;

export type LiveStealsPayload = {
  steals: Steal[];
  meta: StealScanMeta;
  almostQualified: NearMissSteal[];
  feed: StealFeedDiagnostics;
};

export async function fetchStealsWithMeta(): Promise<LiveStealsPayload> {
  if (freshCache && Date.now() - freshCache.at < FRESH_TTL_MS) {
    return {
      steals: freshCache.steals,
      meta: freshCache.meta,
      almostQualified: freshCache.almostQualified,
      feed: freshCache.feed,
    };
  }

  resetLiveStealsPipelineTrace();
  const scanStarted = Date.now();
  const now = Date.now();
  const sportProbes: StealOddsSportProbe[] = [];

  try {
    logLiveStealsStage("1-scan-start", STEAL_SPORTS.length, {
      message: "Calling internal odds routes (The Odds API via /sports/odds)",
      detail: { sports: STEAL_SPORTS, propSports: PROP_STEAL_SPORTS },
    });

    const oddsBySport = new Map<string, OddsRow[]>();
    await Promise.all(
      STEAL_SPORTS.map(async (sport) => {
        const endpoint = `/sports/odds?sport=${sport}`;
        const probe = await probeJson<OddsRow[]>(endpoint);
        const rows = Array.isArray(probe.data) ? probe.data : [];
        sportProbes.push({
          sport,
          endpoint,
          ok: probe.ok && Array.isArray(probe.data),
          httpStatus: probe.httpStatus,
          responseTimeMs: probe.responseTimeMs,
          games: rows.length,
          error: probe.error,
        });
        if (probe.ok && Array.isArray(probe.data)) {
          oddsBySport.set(sport, rows.filter((g) => nearTerm(g.commenceTime, now)));
        }
      }),
    );

    const sportsOk = sportProbes.filter((p) => p.ok).length;
    const sportsFailed = sportProbes.length - sportsOk;
    const gamesNearTerm = [...oddsBySport.values()].reduce((sum, rows) => sum + rows.length, 0);

    logLiveStealsStage("2-odds-api-fetch", sportsOk, {
      message: sportsOk > 0 ? "Odds routes responded" : "All odds routes failed",
      detail: { sportsOk, sportsFailed, sportProbes },
    });

    logLiveStealsStage("3-games-filtered", gamesNearTerm, {
      message: "Games within 48h pickable horizon",
      detail: { gamesNearTerm },
    });

    const baseFeed = emptyStealFeedDiagnostics({
      responseTimeMs: Date.now() - scanStarted,
      sportsProbed: sportProbes.length,
      sportsOk,
      sportsFailed,
      sportProbes,
      scanStages: [...liveStealsPipelineStages()],
    });

    if (sportsOk === 0) {
      const reason =
        sportProbes.find((p) => p.error)?.error ??
        (baseFeed.oddsKeyConfigured ? "all_sports_odds_unreachable" : "ODDS_API_KEY not configured");
      throw new StealFeedScanError(reason, {
        ...baseFeed,
        errorReason: reason,
        scanStages: [...liveStealsPipelineStages()],
        failedStage: "2-odds-api-fetch",
      });
    }

    if (gamesNearTerm === 0) {
      const reason = "no_near_term_games_in_pickable_horizon";
      throw new StealFeedScanError(reason, {
        ...baseFeed,
        errorReason: reason,
        scanStages: [...liveStealsPipelineStages()],
        failedStage: "3-games-filtered",
      });
    }

    let gameTallies: Array<{
      marketsChecked: number;
      longshotsAnalyzed: number;
      books: Set<string>;
    }> = [];
    let gameSteals: Steal[] = [];
    let nearGame: NearMissSteal[] = [];

    try {
      for (const rows of oddsBySport.values()) {
        gameTallies.push(tallyGameScan(rows));
      }
      const marketsChecked = gameTallies.reduce((s, t) => s + t.marketsChecked, 0);
      logLiveStealsStage("4-game-markets-parsed", marketsChecked, {
        message: "Game-line markets parsed from odds feed",
      });

      for (const rows of oddsBySport.values()) {
        gameSteals.push(...findGameSteals(rows));
        nearGame.push(...findNearMissGameSteals(rows));
      }
    } catch (err) {
      failLiveStealsStage("4-game-markets-parsed", err);
    }

    type Cand = { sport: string; g: OddsRow };
    const cands: Cand[] = [];
    for (const sport of PROP_STEAL_SPORTS) {
      for (const g of oddsBySport.get(sport) ?? []) cands.push({ sport, g });
    }
    cands.sort((a, b) => Date.parse(a.g.commenceTime) - Date.parse(b.g.commenceTime));

    let propGames: PropGame[] = [];
    try {
      propGames = await Promise.all(
        cands.slice(0, MAX_PROP_GAMES).map(async ({ sport, g }): Promise<PropGame> => {
          const q = new URLSearchParams({ sport, eventId: g.id, home: g.homeTeam, away: g.awayTeam });
          const r = await fetchJson<{ props?: FeedProp[] }>(`/sports/props?${q.toString()}`);
          return {
            eventId: g.id,
            game: `${g.awayTeam} @ ${g.homeTeam}`,
            sport,
            startsAt: g.commenceTime,
            props: r?.props ?? [],
          };
        }),
      );
      const propRows = propGames.reduce((s, pg) => s + pg.props.length, 0);
      logLiveStealsStage("5-props-fetch", propGames.length, {
        message: "Per-game props routes fetched",
        detail: { gamesFetched: propGames.length, maxGames: MAX_PROP_GAMES },
      });
      logLiveStealsStage("6-player-prop-markets", propRows, {
        message: "Total player prop rows returned",
      });

      const stolenBaseProps = propGames.reduce(
        (s, pg) => s + pg.props.filter((p) => p.market === "batter_stolen_bases").length,
        0,
      );
      logLiveStealsStage("7-stolen-base-props", stolenBaseProps, {
        message: "MLB batter_stolen_bases markets in prop pool",
      });
    } catch (err) {
      failLiveStealsStage("5-props-fetch", err);
    }

    let propTally = { marketsChecked: 0, longshotsAnalyzed: 0 };
    let scanStats = {
      marketsChecked: 0,
      longshotsAnalyzed: 0,
      booksScanned: 0,
      scanComplete: false,
    };
    let propSteals: Steal[] = [];
    let nearProp: NearMissSteal[] = [];

    try {
      propTally = tallyPropScan(propGames);
      scanStats = finalizeStealScanStats(gameTallies, propTally);
      logLiveStealsStage("8-ev-candidates", scanStats.longshotsAnalyzed, {
        message: "Longshots in +500..+30000 band analyzed for EV/edge",
        detail: {
          marketsChecked: scanStats.marketsChecked,
          booksScanned: scanStats.booksScanned,
        },
      });

      propSteals = findPropSteals(propGames);
      nearProp = findNearMissPropSteals(propGames);
    } catch (err) {
      failLiveStealsStage("8-ev-candidates", err);
    }

    let steals: Steal[] = [];
    let almostQualified: NearMissSteal[] = [];
    try {
      const byId = new Map<string, Steal>();
      for (const s of [...gameSteals, ...propSteals]) {
        const prev = byId.get(s.id);
        if (!prev || (s.ev ?? 0) > (prev.ev ?? 0)) byId.set(s.id, s);
      }
      steals = Array.from(byId.values())
        .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))
        .slice(0, MAX_STEALS);

      const nearById = new Map<string, NearMissSteal>();
      for (const s of [...nearGame, ...nearProp]) {
        if (byId.has(s.id)) continue;
        const prev = nearById.get(s.id);
        if (!prev || (s.ev ?? 0) > (prev.ev ?? 0)) nearById.set(s.id, s);
      }
      almostQualified = Array.from(nearById.values())
        .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
        .slice(0, 12);

      logLiveStealsStage("9-ranked-picks", steals.length, {
        message: "Final ranked steals after dedupe and EV sort",
        detail: { almostQualified: almostQualified.length },
      });
    } catch (err) {
      failLiveStealsStage("9-ranked-picks", err);
    }

    const meta = buildScanMeta(steals, almostQualified, scanStats);
    const feed: StealFeedDiagnostics = {
      ...baseFeed,
      responseTimeMs: Date.now() - scanStarted,
      errorReason: null,
      scanStages: [...liveStealsPipelineStages()],
      failedStage: null,
    };

    freshCache = { at: Date.now(), steals, meta, almostQualified, feed };
    return { steals, meta, almostQualified, feed };
  } catch (err) {
    const failure = liveStealsPipelineFailure();
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (stack) {
      console.error(`[live-steals-pipeline] unhandled failure:\n${stack}`);
    }

    if (err instanceof StealFeedScanError) {
      throw err;
    }

    const feed = emptyStealFeedDiagnostics({
      responseTimeMs: Date.now() - scanStarted,
      sportsProbed: sportProbes.length,
      sportsOk: sportProbes.filter((p) => p.ok).length,
      sportsFailed: sportProbes.filter((p) => !p.ok).length,
      sportProbes,
      errorReason: message,
      scanStages: [...liveStealsPipelineStages()],
      failedStage: failure.stage,
    });
    throw new StealFeedScanError(message, feed, { failedStage: failure.stage, cause: err });
  }
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
