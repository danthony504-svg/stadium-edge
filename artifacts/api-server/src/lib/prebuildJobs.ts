import { warmPreparedGameContexts } from "./preparedGameContext.js";
import { loadAuthoritativePlayerHistory } from "./authoritativePlayerHistory";
import { fetchEspnInjuries } from "./espnInjuries";
import { classifyVacancyConfirmation, teamMatch } from "./opportunityShift/index";
import { withInflightCoalesce } from "./propSimDedicatedStore";
import { logger } from "./logger";
import { MARKETS_BY_SPORT } from "../routes/props";

// -------------------------------------------------------------------------
// Scheduled cache pre-warming. The mobile Props tab (and the AI coach's
// chat-context build) read three server caches: the bulk odds slate
// (/sports/odds), the ESPN game list (/sports/games), and per-event player
// props (/sports/props, which also computes the EV/edge values). All three
// are short-TTL caches that only get populated when a USER request happens to
// hit a cold key — so the first user after a TTL expiry eats the full upstream
// latency (and, under a burst, risks 429s).
//
// This job warms those caches AHEAD of users on a schedule. The API server
// deploys as AUTOSCALE, so a background setInterval can't be trusted to run —
// a Scheduled Deployment hits POST /api/prebuild/cron instead and this
// function does the work. Everything goes through the server's OWN cached
// routes over loopback with the x-internal-call marker, so warming shares the
// exact cache keys the user-facing routes read and BYPASSES the per-IP rate
// limiter (which would otherwise 429 our own burst, see lib/sports.ts). Work
// is bounded (small concurrency + stagger between sports) and every fetch is
// best-effort: a single failure is logged and skipped, never thrown, so one
// dead league can't abort the run.
// -------------------------------------------------------------------------

// PROPS sports drive both prop warming AND odds/games warming — these are the
// leagues the Props tab loads. Derived from the same source of truth the props
// route uses, so adding a sport there automatically warms it here.
const PROPS_SPORTS = [...new Set([...Object.keys(MARKETS_BY_SPORT), "tennis"])];

// How many of the soonest games per sport to warm props for. The client loads
// props in small batches and the chat context uses the soonest games first, so
// warming the front of each slate covers the common case without fanning out a
// per-event request for every game on the board.
const PROPS_GAMES_PER_SPORT = 8;

// Bounded concurrency: keep upstream pressure low so we never trip the Odds API
// per-second frequency limit (the props route already retries 429s, but staying
// under the limit is cheaper than riding the backoff).
const SPORT_CONCURRENCY = 2;
const PROPS_CONCURRENCY = 3;
// Small gap between sport batches so the bursts don't stack up.
const STAGGER_MS = 250;

function apiBase(): string {
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}/api`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Loopback GET against our own cached route. The x-internal-call header + the
// loopback origin together exempt this from the per-IP rate limiter (see
// rateLimit in lib/sports.ts). Returns parsed JSON, or null on any failure —
// warming is best-effort and must never throw out of the run.
async function warmGet<T>(path: string, attempts = 3): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${apiBase()}${path}`, {
        headers: { "x-internal-call": "1" },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return (await r.json()) as T;
      // Only transient upstream failures are worth retrying; a 4xx is a bad
      // request that won't get better.
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || i === attempts - 1) {
        await r.text().catch(() => {});
        return null;
      }
      await r.text().catch(() => {});
    } catch {
      if (i === attempts - 1) return null;
    }
    // Backoff + jitter so concurrent warmers don't retry in lockstep.
    await sleep(300 * 2 ** i + Math.floor(Math.random() * 150));
  }
  return null;
}

// Run an async mapper over items with a fixed worker pool (bounded concurrency).
async function pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}

type GameRow = {
  id: string;
  startsAt: string;
  status?: string;
  state?: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeAbbr?: string | null;
  venue?: string | null;
};

// Warm one sport: its bulk odds slate, its ESPN game list, and per-event props
// for the soonest games. Returns a small per-sport tally for the run summary.
async function warmSport(
  sport: string,
): Promise<{ sport: string; odds: boolean; games: number; props: number; histories: number; contexts: number }> {
  // Odds + games in parallel — independent caches.
  const [odds, games, injuries] = await Promise.all([
    warmGet<unknown[]>(`/sports/odds?sport=${sport}`),
    warmGet<GameRow[]>(`/sports/games?sport=${sport}`),
    fetchEspnInjuries(sport),
  ]);
  const oddsOk = odds != null;

  const rows = Array.isArray(games) ? games : [];
  // Soonest UPCOMING games first. Skip finished/in-progress games — props are
  // only useful pregame and a finished game's props are dead weight.
  const upcoming = rows
    .filter((g) => {
      const st = (g.state || "").toLowerCase();
      const status = (g.status || "").toLowerCase();
      if (st === "post" || status === "final") return false;
      const t = Date.parse(g.startsAt);
      return Number.isFinite(t) && t > Date.now();
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, PROPS_GAMES_PER_SPORT);

  // Precompute reusable source data, not frozen tickets. This job is server-side
  // so it can run while phones are closed; never invoke it from a public GET.
  const historyIds = new Set<string>();
  for (const team of injuries) {
    if (!upcoming.some(g => teamMatch(team.team ?? "", g.homeTeam ?? "") || teamMatch(team.team ?? "", g.awayTeam ?? ""))) continue;
    for (const entry of team.entries ?? []) {
      if (entry.athleteId && classifyVacancyConfirmation(entry.status ?? "") === "out" && historyIds.size < 8) {
        historyIds.add(entry.athleteId);
      }
    }
  }
  let propCount = 0;
  await pooled(upcoming, PROPS_CONCURRENCY, async (g) => {
    if (!MARKETS_BY_SPORT[sport] || !g.homeTeam || !g.awayTeam) return;
    const q = new URLSearchParams({ sport, eventId: g.id });
    q.set("home", g.homeTeam);
    q.set("away", g.awayTeam);
    // Pass startsAt so MLB DH / same-day identity resolve is not ambiguous
    // and cannot null-poison the prop-event-team-identity cache.
    if (g.startsAt) q.set("startsAt", g.startsAt);
    if (g.homeTeamId) q.set("homeTeamId", g.homeTeamId);
    if (g.awayTeamId) q.set("awayTeamId", g.awayTeamId);
    const r = await warmGet<{ props?: Array<{ athleteId?: string | null }> }>(`/sports/props?${q.toString()}`);
    if (r) propCount++;
    for (const row of r?.props ?? []) {
      if (row.athleteId && historyIds.size < 16) historyIds.add(row.athleteId);
    }
  });

  let histories = 0;
  await pooled([...historyIds], 2, async athleteId => {
    const result = await loadAuthoritativePlayerHistory(sport, athleteId).catch(() => null);
    if (result?.history) histories++;
  });
  const contexts = await warmPreparedGameContexts(sport, rows);
  return { sport, odds: oddsOk, games: rows.length, props: propCount, histories, contexts };
}

async function runPrebuildJobsBody(): Promise<{
  ok: true;
  summary: { sports: number; gamesWarmed: number; propsWarmed: number; historiesWarmed: number; contextsWarmed: number };
  perSport: Array<{ sport: string; odds: boolean; games: number; props: number; histories: number; contexts: number }>;
}> {
  const perSport: Array<{ sport: string; odds: boolean; games: number; props: number; histories: number; contexts: number }> = [];

  // Warm sports in small staggered batches so upstream bursts stay bounded.
  for (let i = 0; i < PROPS_SPORTS.length; i += SPORT_CONCURRENCY) {
    const batch = PROPS_SPORTS.slice(i, i + SPORT_CONCURRENCY);
    const results = await Promise.all(batch.map((s) => warmSport(s)));
    perSport.push(...results);
    if (i + SPORT_CONCURRENCY < PROPS_SPORTS.length) await sleep(STAGGER_MS);
  }

  const summary = {
    sports: perSport.length,
    gamesWarmed: perSport.reduce((n, s) => n + s.games, 0),
    propsWarmed: perSport.reduce((n, s) => n + s.props, 0),
    historiesWarmed: perSport.reduce((n, s) => n + s.histories, 0),
    contextsWarmed: perSport.reduce((n, s) => n + s.contexts, 0),
  };
  logger.info({ summary }, "prebuild cron run");
  return { ok: true, summary, perSport };
}

/** Coalesce overlapping scheduled runs; there is no app-open cron trigger. */
export async function runPrebuildJobs() {
  return (await withInflightCoalesce("prebuild-context", runPrebuildJobsBody)).value;
}
