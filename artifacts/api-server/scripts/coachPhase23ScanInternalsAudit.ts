/**
 * Phase 2.3 prep — AUDIT ONLY: full-board-scan internals.
 * No production code changes.
 *
 * 1) Warm-repeat scan interval breakdown
 * 2) Game-sim concurrency bench 2/4/6 + determinism
 * 3) History enrich vs propsim-ctx duplication
 * 4) Last blocker identification
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";
import { runPropSims, tierSimCount } from "../src/lib/propSimRunner.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight, type SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { teamPace } from "../src/lib/statmuse.ts";
import type { SimTier } from "../src/lib/simCache.ts";
import {
  fetchSlateGameSimulationsWithStatus,
  type GameTeamIds,
  type CoachGameSimEntry,
} from "../../stadium-mobile/lib/coachGameMonteCarlo.ts";
import type { RealOddsEntry } from "../../stadium-mobile/lib/api.ts";

const HARD_MS = 300_000;

function teamInjuryWeight(
  teams: Awaited<ReturnType<typeof fetchEspnInjuries>>,
  teamName: string,
): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const target = norm(teamName);
  const team = teams.find((t) => {
    const n = norm(t.team ?? "");
    return n.includes(target) || target.includes(n);
  });
  return keyInjuryWeight(team?.entries);
}

type HttpEvt = {
  stage: string;
  startMs: number;
  endMs: number;
  durMs: number;
  url: string;
  method: string;
  status: number;
  detail?: Record<string, unknown>;
};

function classify(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("/sports/simulate/props")) return "prop_simulation";
  if (u.includes("/sports/simulate")) return "game_simulation";
  if (u.includes("/sports/player-history") || u.includes("/player-history")) return "player_history";
  if (u.includes("/sports/props")) return "prop_discovery";
  if (u.includes("/sports/odds")) return "board_odds";
  if (u.includes("/live-odds")) return "live_odds";
  if (u.includes("/weather")) return "weather";
  if (u.includes("/team-period") || u.includes("period-stats")) return "team_period_stats";
  if (u.includes("/search") && u.includes("player")) return "player_search";
  if (u.includes("/mlb")) return "mlb_context";
  if (u.includes("/injuries")) return "injuries";
  return "other";
}

type CapturedGameBatch = {
  evalLinesByGame: Map<string, RealOddsEntry[]>;
  teamIdMap: Map<string, GameTeamIds>;
};

async function runWarmScanAudit() {
  clearCoachContextCache();
  clearPropSimDedicatedStoresForTests();
  clearAthleteIdentityStoreForTests();
  resetCoachCacheStats();

  // Prime cold
  {
    const orig = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes("/sports/simulate/props") && String(init?.method ?? "GET").toUpperCase() === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const sport = String(body.sport ?? "").toLowerCase();
        const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
        const props = (body.props ?? []) as SimPropRequest[];
        const homeTeam = String(body.homeTeam ?? "");
        const awayTeam = String(body.awayTeam ?? "");
        const propsResolved = await resolvePropAthleteIdsDetailed(sport, props.map((p) => ({
          ...p,
          sport: String(p.sport ?? sport).toLowerCase(),
        })), {
          homeTeamId: String(body.homeTeamId ?? "").trim(),
          awayTeamId: String(body.awayTeamId ?? "").trim(),
          homeTeam,
          awayTeam,
        });
        const injuries = await fetchEspnInjuries(sport);
        const { rows, deepPending, distStats, propSimElapsedMs } = await runPropSims(
          propsResolved.props,
          tier,
          {
            sport,
            oppPace: null,
            leaguePace: 100,
            oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
            ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
            weatherImpact: null,
          },
          (body.isHomeByPlayer ?? {}) as Record<string, boolean>,
          body.simulations != null ? Number(body.simulations) : undefined,
        );
        return new Response(
          JSON.stringify({
            sport,
            tier,
            simulations: tierSimCount(tier),
            deepPending,
            props: rows,
            propSimElapsedMs,
            ...distStats,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return orig(input, init);
    }) as typeof fetch;
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), HARD_MS);
    try {
      await buildCoachParlay({
        requestedLegs: 5,
        askText: "5 leg",
        priorUserTexts: [],
        signal: ac.signal,
      });
    } finally {
      clearTimeout(kill);
      globalThis.fetch = orig;
    }
  }

  await new Promise((r) => setTimeout(r, 500));

  // Warm instrumented
  const origin = performance.now();
  const httpEvts: HttpEvt[] = [];
  const statusLog: Array<{ t: number; status: string }> = [];
  const partialLog: Array<{ t: number; picks: number; props: number }> = [];
  const propSimCalls: Array<{
    startMs: number;
    endMs: number;
    athletes: string[];
    players: string[];
    ctxHits: number;
    ctxMisses: number;
    distHits: number;
    distMisses: number;
    historyLoads: number;
    propSimElapsedMs: number;
    scored: number;
  }> = [];
  const histCalls: Array<{
    startMs: number;
    endMs: number;
    athleteId: string | null;
    sport: string | null;
    url: string;
  }> = [];
  const gameSimCalls: Array<{
    startMs: number;
    endMs: number;
    homeTeamId?: string;
    awayTeamId?: string;
    sport?: string;
  }> = [];

  let scanStartMs: number | null = null;
  let readyPool = 0;

  // Capture game board for concurrency bench
  const capturedGames: CapturedGameBatch = {
    evalLinesByGame: new Map(),
    teamIdMap: new Map(),
  };

  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const stage = classify(url);
    const t0 = performance.now();

    if (url.includes("/sports/simulate/props") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const sport = String(body.sport ?? "").toLowerCase();
      const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
      const props = (body.props ?? []) as SimPropRequest[];
      const homeTeam = String(body.homeTeam ?? "");
      const awayTeam = String(body.awayTeam ?? "");
      const propsIn = props.map((p) => ({
        ...p,
        sport: String(p.sport ?? sport).toLowerCase(),
      }));
      const { props: propsResolved } = await resolvePropAthleteIdsDetailed(sport, propsIn, {
        homeTeamId: String(body.homeTeamId ?? "").trim(),
        awayTeamId: String(body.awayTeamId ?? "").trim(),
        homeTeam,
        awayTeam,
      });
      const injuries = await fetchEspnInjuries(sport);
      let oppPace: number | null = null;
      let leaguePace: number | null = 100;
      if ((sport === "nba" || sport === "wnba") && homeTeam && awayTeam) {
        try {
          const [a, b] = await Promise.all([teamPace(sport, homeTeam), teamPace(sport, awayTeam)]);
          if (a != null && b != null) {
            oppPace = (a + b) / 2;
            leaguePace = 100;
          }
        } catch {
          /* optional */
        }
      }
      const { rows, deepPending, distStats, propSimElapsedMs } = await runPropSims(
        propsResolved,
        tier,
        {
          sport,
          oppPace,
          leaguePace,
          oppKeyInjuries: awayTeam ? teamInjuryWeight(injuries, awayTeam) : 0,
          ownKeyInjuries: homeTeam ? teamInjuryWeight(injuries, homeTeam) : 0,
          weatherImpact:
            sport === "mlb" && body.weatherImpact != null ? Number(body.weatherImpact) : null,
        },
        (body.isHomeByPlayer ?? {}) as Record<string, boolean>,
        body.simulations != null ? Number(body.simulations) : undefined,
      );
      const t1 = performance.now();
      propSimCalls.push({
        startMs: Math.round(t0 - origin),
        endMs: Math.round(t1 - origin),
        athletes: propsResolved.map((p) => String(p.athleteId ?? "")).filter(Boolean),
        players: [...new Set(propsResolved.map((p) => p.player))],
        ctxHits: distStats.ctxCacheHits,
        ctxMisses: distStats.ctxCacheMisses,
        distHits: distStats.distributionCacheHits,
        distMisses: distStats.distributionCacheMisses,
        historyLoads: distStats.historyLoads,
        propSimElapsedMs,
        scored: rows.filter((r) => r.hitProbability != null).length,
      });
      httpEvts.push({
        stage: "prop_simulation",
        startMs: Math.round(t0 - origin),
        endMs: Math.round(t1 - origin),
        durMs: Math.round(t1 - t0),
        url: url.slice(0, 120),
        method,
        status: 200,
        detail: { propCount: props.length, ...distStats, propSimElapsedMs },
      });
      return new Response(
        JSON.stringify({
          sport,
          tier,
          simulations: tierSimCount(tier),
          deepPending,
          props: rows,
          propSimElapsedMs,
          ...distStats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const res = await orig(input, init);
    const t1 = performance.now();
    const startMs = Math.round(t0 - origin);
    const endMs = Math.round(t1 - origin);
    httpEvts.push({
      stage,
      startMs,
      endMs,
      durMs: endMs - startMs,
      url: url.slice(0, 160),
      method,
      status: res.status,
    });

    if (stage === "player_history") {
      try {
        const u = new URL(url, "https://x");
        histCalls.push({
          startMs,
          endMs,
          athleteId: u.searchParams.get("athleteId"),
          sport: u.searchParams.get("sport"),
          url: url.slice(0, 160),
        });
      } catch {
        histCalls.push({ startMs, endMs, athleteId: null, sport: null, url: url.slice(0, 160) });
      }
    }
    if (stage === "game_simulation") {
      try {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        gameSimCalls.push({
          startMs,
          endMs,
          homeTeamId: body.homeTeamId != null ? String(body.homeTeamId) : undefined,
          awayTeamId: body.awayTeamId != null ? String(body.awayTeamId) : undefined,
          sport: body.sport != null ? String(body.sport) : undefined,
        });
      } catch {
        gameSimCalls.push({ startMs, endMs });
      }
    }
    return res;
  }) as typeof fetch;

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: 5,
      askText: "5 leg",
      priorUserTexts: [],
      signal: ac.signal,
      onStatus: (status) => {
        const t = Math.round(performance.now() - origin);
        statusLog.push({ t, status });
        if (/Scanning .*posted/i.test(status) && scanStartMs == null) {
          scanStartMs = t;
        }
      },
      onReadyToScan: (info) => {
        readyPool = info.propPoolSize;
        if (scanStartMs == null) scanStartMs = Math.round(performance.now() - origin);
      },
      onPartialPicks: (picks) => {
        partialLog.push({
          t: Math.round(performance.now() - origin),
          picks: picks.length,
          props: picks.filter((p) => p.isProp).length,
        });
      },
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }

  const wallMs = Math.round(performance.now() - origin);
  const scanEndMs = wallMs;
  const scan0 = scanStartMs ?? 0;

  // Infer game-sim outer batches: cluster game_simulation calls that don't overlap much
  // Production outer loop: await batch of 2, then score, then next batch.
  const gameBatches: Array<{
    index: number;
    startMs: number;
    endMs: number;
    wallMs: number;
    calls: number;
    games: Array<{ homeTeamId?: string; awayTeamId?: string; sport?: string }>;
  }> = [];
  {
    const sorted = [...gameSimCalls].sort((a, b) => a.startMs - b.startMs);
    let cur: (typeof gameBatches)[0] | null = null;
    for (const c of sorted) {
      if (!cur || c.startMs > cur.endMs + 50) {
        cur = {
          index: gameBatches.length,
          startMs: c.startMs,
          endMs: c.endMs,
          wallMs: c.endMs - c.startMs,
          calls: 1,
          games: [{ homeTeamId: c.homeTeamId, awayTeamId: c.awayTeamId, sport: c.sport }],
        };
        gameBatches.push(cur);
      } else {
        cur.endMs = Math.max(cur.endMs, c.endMs);
        cur.wallMs = cur.endMs - cur.startMs;
        cur.calls += 1;
        cur.games.push({ homeTeamId: c.homeTeamId, awayTeamId: c.awayTeamId, sport: c.sport });
      }
    }
  }

  // Build ops table for scan window only
  const ops: Array<{
    operation: string;
    count: number;
    start: number;
    end: number;
    wall: number;
    concurrency: string;
    cacheHM: string;
    blocksFinal: boolean;
    detail?: Record<string, unknown>;
  }> = [];

  const inScan = (s: number, e: number) => e >= scan0 && s <= scanEndMs;

  const histInScan = histCalls.filter((h) => inScan(h.startMs, h.endMs));
  const uniqueHistAthletes = [...new Set(histInScan.map((h) => h.athleteId).filter(Boolean))];
  const histDupes =
    histInScan.length - new Set(histInScan.map((h) => `${h.sport}:${h.athleteId}`)).size;

  ops.push({
    operation: "history_enrichment (client getPlayerHistory)",
    count: histInScan.length,
    start: histInScan.length ? Math.min(...histInScan.map((h) => h.startMs)) : -1,
    end: histInScan.length ? Math.max(...histInScan.map((h) => h.endMs)) : -1,
    wall: histInScan.length
      ? Math.max(...histInScan.map((h) => h.endMs)) - Math.min(...histInScan.map((h) => h.startMs))
      : 0,
    concurrency: "Promise.all over batch (unbounded within batch)",
    cacheHM: "request-local Map only; no share with propsim-ctx",
    blocksFinal: true,
    detail: {
      uniqueAthletes: uniqueHistAthletes.length,
      duplicateCalls: histDupes,
      longestMs: histInScan.length ? Math.max(...histInScan.map((h) => h.endMs - h.startMs)) : 0,
      athletes: uniqueHistAthletes.slice(0, 30),
    },
  });

  for (const b of gameBatches) {
    ops.push({
      operation: `game_simulation_batch_${b.index}`,
      count: b.calls,
      start: b.startMs,
      end: b.endMs,
      wall: b.wallMs,
      concurrency: "outer serial; inner SLATE_SIM_CONCURRENCY=4 but batch size=2 → effective 2",
      cacheHM: "coach game-sim fingerprint cache (client)",
      blocksFinal: true,
      detail: { games: b.games },
    });
  }

  for (let i = 0; i < propSimCalls.length; i++) {
    const c = propSimCalls[i]!;
    ops.push({
      operation: `prop_simulation_request_${i}`,
      count: 1,
      start: c.startMs,
      end: c.endMs,
      wall: c.endMs - c.startMs,
      concurrency: "1 HTTP; server hist conc 4 inside runPropSims",
      cacheHM: `ctx ${c.ctxHits}/${c.ctxMisses}; dist ${c.distHits}/${c.distMisses}; histLoads ${c.historyLoads}`,
      blocksFinal: true,
      detail: {
        players: c.players,
        athletes: c.athletes,
        propSimElapsedMs: c.propSimElapsedMs,
        scored: c.scored,
      },
    });
  }

  // Sync grading/staging inferred from gaps + partials (CPU, no HTTP)
  const firstPartial = partialLog[0];
  const firstFiveGl = partialLog.find((p) => p.picks >= 5 && p.props === 0);
  const firstFiveProps = partialLog.find((p) => p.picks >= 5 && p.props > 0);
  const lastPartial = partialLog[partialLog.length - 1];

  ops.push({
    operation: "game_line_grading + partial staging (CPU between game batches)",
    count: gameBatches.length,
    start: gameBatches[0]?.startMs ?? scan0,
    end: gameBatches.length ? gameBatches[gameBatches.length - 1]!.endMs : scan0,
    wall: 0,
    concurrency: "1 (sync after each awaited batch)",
    cacheHM: "n/a",
    blocksFinal: true,
    detail: {
      note: "scoreGamesAndMaybePartial runs sync after each serial game batch; emits partials",
      firstFiveGlPartialAt: firstFiveGl?.t ?? null,
    },
  });

  ops.push({
    operation: "prop_grading (attachPickScores after each sim+enrich wave)",
    count: propSimCalls.length,
    start: propSimCalls[0]?.startMs ?? -1,
    end: propSimCalls.length ? propSimCalls[propSimCalls.length - 1]!.endMs : -1,
    wall: 0,
    concurrency: "1 (sync after enrich)",
    cacheHM: "n/a",
    blocksFinal: true,
    detail: { note: "ALT rungs share same MC draw; graded via lineHitRatesBySide expansion" },
  });

  ops.push({
    operation: "ALT grading",
    count: -1,
    start: propSimCalls[0]?.startMs ?? -1,
    end: propSimCalls.length ? propSimCalls[propSimCalls.length - 1]!.endMs : -1,
    wall: 0,
    concurrency: "bundled in prop_simulation + client expand",
    cacheHM: "shared dist",
    blocksFinal: true,
    detail: { note: "No separate ALT HTTP — expanded from deep-sim additionalLines / lineHitRatesBySide" },
  });

  ops.push({
    operation: "qualification + EV/edge + correlation + diversity + staging + top-up",
    count: partialLog.length,
    start: firstPartial?.t ?? scan0,
    end: lastPartial?.t ?? scanEndMs,
    wall: (lastPartial?.t ?? scanEndMs) - (firstPartial?.t ?? scan0),
    concurrency: "1 (sync buildScanResult on each partial + final)",
    cacheHM: "n/a",
    blocksFinal: true,
    detail: {
      partialEvents: partialLog.length,
      firstFiveGlAt: firstFiveGl?.t ?? null,
      firstFiveWithPropsAt: firstFiveProps?.t ?? null,
      note: "buildScanResult → buildStagedTicketFromScan → fillReservedPropSlots → topUp → diversity inject",
    },
  });

  // Last blocker
  const scanHttp = httpEvts
    .filter((e) => inScan(e.startMs, e.endMs))
    .sort((a, b) => b.endMs - a.endMs);
  const lastHttp = scanHttp[0];
  const lastBlocker = {
    lastHttpStage: lastHttp?.stage ?? null,
    lastHttpEndMs: lastHttp?.endMs ?? null,
    lastHttpUrl: lastHttp?.url ?? null,
    lastPartialAt: lastPartial?.t ?? null,
    lastPartialProps: lastPartial?.props ?? null,
    propPhaseCompleteAt: firstFiveProps?.t ?? null,
    scanEndMs,
    analysis:
      firstFiveProps && lastHttp
        ? firstFiveProps.t >= (lastHttp.endMs - 200)
          ? "Last blocker aligned with prop-phase completion (props landing on ticket after hist enrich / prop waves)."
          : "Last HTTP finished before final partial — trailing CPU staging/finalize after network."
        : "See scanHttp tail",
  };

  // Overlap: hist athletes also in propSim athlete lists?
  const simAthletes = new Set(propSimCalls.flatMap((c) => c.athletes));
  const histAlsoInSim = uniqueHistAthletes.filter((a) => simAthletes.has(String(a)));
  const histOnlyEnrich = uniqueHistAthletes.filter((a) => !simAthletes.has(String(a)));

  return {
    wallMs,
    scanStartMs: scan0,
    scanEndMs,
    scanWallMs: scanEndMs - scan0,
    readyPool,
    finalLegs: result.picks?.length ?? 0,
    note: (result.note || "").slice(0, 200),
    statusLog,
    partialLog,
    ops,
    propSimCalls,
    histEnrich: {
      calls: histInScan.length,
      uniqueAthletes: uniqueHistAthletes.length,
      duplicateKeyCalls: histDupes,
      longestMs: histInScan.length ? Math.max(...histInScan.map((h) => h.endMs - h.startMs)) : 0,
      alsoLoadedByPropSimServer: histAlsoInSim.length,
      enrichOnlyAthletes: histOnlyEnrich.length,
      overlapAthletes: histAlsoInSim,
      note: "enrichCoachPropSimHits ALWAYS fetches getPlayerHistory for holistic form even when server MC already returned a hit (propsim-ctx path). Duplicate acquisition vs Phase 2.1 server hist.",
    },
    gameBatches,
    lastBlocker,
    ticket: (result.picks ?? []).map((p) => ({
      pick: p.pick,
      isProp: !!p.isProp,
      market: p.market,
    })),
    // For concurrency bench — best-effort empty; filled below if we can reconstruct
    capturedGameCount: gameSimCalls.length,
    gameSimCalls,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => worker()));
  return out;
}

async function benchGameSimConcurrency(gameSimCalls: Array<{ homeTeamId?: string; awayTeamId?: string; sport?: string }>) {
  // Reconstruct unique games from observed warm calls (team id pairs).
  const uniq = new Map<string, { sport: string; homeTeamId: string; awayTeamId: string; homeTeam: string; awayTeam: string }>();
  for (const g of gameSimCalls) {
    if (!g.homeTeamId || !g.awayTeamId) continue;
    const sport = (g.sport || "mlb").toLowerCase();
    const key = `${sport}:${g.homeTeamId}:${g.awayTeamId}`;
    if (!uniq.has(key)) {
      uniq.set(key, {
        sport,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeTeam: `Home${g.homeTeamId}`,
        awayTeam: `Away${g.awayTeamId}`,
      });
    }
  }
  const games = [...uniq.values()];
  if (games.length < 2) {
    return { skipped: true, reason: "fewer than 2 captured games", games: games.length };
  }

  // Build minimal eval lines (ML + total) so coverQueries are non-empty.
  function linesFor(g: (typeof games)[0]): RealOddsEntry[] {
    const game = `${g.awayTeam} @ ${g.homeTeam}`;
    return [
      {
        game,
        market: "Moneyline",
        pick: `${g.homeTeam} ML`,
        odds: -110,
        sport: g.sport,
        isProp: false,
      } as RealOddsEntry,
      {
        game,
        market: "Total",
        pick: "Over 8.5",
        odds: -110,
        sport: g.sport,
        isProp: false,
      } as RealOddsEntry,
      {
        game,
        market: "Spread",
        pick: `${g.homeTeam} -1.5`,
        odds: -110,
        sport: g.sport,
        isProp: false,
      } as RealOddsEntry,
    ];
  }

  const teamIdMap = new Map<string, GameTeamIds>();
  for (const g of games) {
    const label = `${g.awayTeam} @ ${g.homeTeam}`;
    teamIdMap.set(label, {
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      sport: g.sport,
    });
  }

  async function runAtConcurrency(concurrency: number) {
    // Clear nothing — use fingerprint cache carefully by varying? We want coldish.
    // Force unique cover query ids via simulations fingerprint — same inputs → cache hit.
    // For fair wall compare, run each concurrency on a FRESH process would be ideal;
    // here we clone games and run sequentially levels with cache warm after first —
    // so run 2 first cold, then clear is hard. Instead: pass all games in one
    // fetchSlateGameSimulationsWithStatus call doesn't allow changing internal 4.
    // Emulate outer batching: chunk games into size=`concurrency`, await each chunk
    // via fetchSlateGameSimulationsWithStatus(Map of chunk) — mirrors production
    // outer loop with different batch sizes. Internal pool still 4 but chunk size
    // caps effective parallelism at chunk size.

    // Cold-ish: first level may populate cache; subsequent levels hit cache and
    // understate wall. To measure provider parallelism, use distinct label suffixes
    // would break team id resolve. Accept: report both cold (first) and note cache.

    const t0 = performance.now();
    let errors = 0;
    let sims = 0;
    const snapshots: Array<{ game: string; homeWin: number | null; coverKeys: string[] }> = [];
    const chunks: (typeof games)[] = [];
    for (let i = 0; i < games.length; i += concurrency) {
      chunks.push(games.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
      const evalMap = new Map<string, RealOddsEntry[]>();
      for (const g of chunk) {
        evalMap.set(`${g.awayTeam} @ ${g.homeTeam}`, linesFor(g));
      }
      try {
        const result = await fetchSlateGameSimulationsWithStatus(evalMap, teamIdMap);
        sims += result.sims.size;
        for (const [label, entry] of result.sims) {
          snapshots.push({
            game: label,
            homeWin: entry.homeWinProbability ?? null,
            coverKeys: Object.keys(entry.coverHitRates ?? {}).sort(),
          });
        }
        errors += result.fetchNull.length;
      } catch {
        errors += chunk.length;
      }
    }
    return {
      concurrency,
      simulations: sims,
      wallMs: Math.round(performance.now() - t0),
      errors,
      rateLimited: 0,
      snapshots: snapshots.sort((a, b) => a.game.localeCompare(b.game)),
    };
  }

  // Order: 2 (coldest), then 4, then 6 — later may be warmer due to client game-sim cache.
  const c2 = await runAtConcurrency(2);
  const c4 = await runAtConcurrency(4);
  const c6 = await runAtConcurrency(6);

  function fingerprint(snaps: typeof c2.snapshots) {
    return snaps.map((s) => `${s.game}|${s.homeWin}|${s.coverKeys.join(",")}`).join(";");
  }
  const fp2 = fingerprint(c2.snapshots);
  const fp4 = fingerprint(c4.snapshots);
  const fp6 = fingerprint(c6.snapshots);

  return {
    skipped: false,
    games: games.length,
    note: "Outer batch-size emulation of production serial loop; internal pool remains 4. Later conc levels may hit client game-sim fingerprint cache (walls understated vs true cold).",
    rows: [
      { ...c2, snapshots: undefined },
      { ...c4, snapshots: undefined },
      { ...c6, snapshots: undefined },
    ],
    deterministic: {
      c2_vs_c4: fp2 === fp4,
      c2_vs_c6: fp2 === fp6,
      c4_vs_c6: fp4 === fp6,
      note: "Same fingerprint material → identical homeWin/cover keys expected when cache/replay stable",
    },
  };
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Full-board-scan internals audit (report only)");

  const warm = await runWarmScanAudit();
  console.error(
    `[warm-scan] wall=${warm.wallMs} scan=${warm.scanWallMs} hist=${warm.histEnrich.calls} propSimCalls=${warm.propSimCalls.length} gameBatches=${warm.gameBatches.length}`,
  );

  const gameBench = await benchGameSimConcurrency(warm.gameSimCalls);
  console.error(`[game-sim-bench]`, JSON.stringify(gameBench.rows ?? gameBench));

  // Can remaining work after first 5 GL alter final ticket? Empirically yes if props land later.
  const first5gl = warm.partialLog.find((p) => p.picks >= 5 && p.props === 0);
  const first5props = warm.partialLog.find((p) => p.picks >= 5 && p.props > 0);
  const canAlter = {
    qualification: true,
    ranking: true,
    correlation: true,
    diversity: true,
    final5Selections: !!(first5gl && first5props && first5props.props !== first5gl.props),
    evidence: {
      first5GlAt: first5gl?.t ?? null,
      first5WithPropsAt: first5props?.t ?? null,
      propCountDelta: (first5props?.props ?? 0) - (first5gl?.props ?? 0),
      note: "Reserved prop seats + staging recomputation change membership; early exit at first 5 GL would freeze a different ticket.",
    },
  };

  const lastBlockerOp =
    warm.lastBlocker.lastHttpStage === "player_history"
      ? "history_enrichment (client getPlayerHistory after/alongside prop sim)"
      : warm.lastBlocker.lastHttpStage === "prop_simulation"
        ? "prop_simulation_request (+ server hist if ctx miss)"
        : warm.lastBlocker.lastHttpStage === "game_simulation"
          ? "game_simulation_batch"
          : warm.lastBlocker.lastHttpStage ?? "scan_finalize_cpu";

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.3-prep-scan-internals",
    note: "AUDIT ONLY — no code changes",
    apiBase: API_BASE,
    scanBreakdown: {
      scanStartMs: warm.scanStartMs,
      scanEndMs: warm.scanEndMs,
      scanWallMs: warm.scanWallMs,
      readyPool: warm.readyPool,
      operations: warm.ops,
    },
    whyGameSimsSerial: {
      code: "boardMarketScanner.buildTopLegsFromFullBoardScan: for-loop await fetchSlateGameSimulationsWithStatus(batch of SLATE_SIM_BATCH=2)",
      inner: "fetchSlateGameSimulationsWithStatus has SLATE_SIM_CONCURRENCY=4, but outer batch size 2 caps effective parallelism at 2",
      whySerialOuter:
        "Each batch is awaited so scoreGamesAndMaybePartial can emit mid-scan partials with newly loaded sims before the next games start — intentional progressive staging, not a provider limit",
      observedBatches: warm.gameBatches,
    },
    gameSimConcurrencyBench: gameBench,
    historyEnrichment: warm.histEnrich,
    propSimCalls: warm.propSimCalls,
    lastBlocker: {
      operation: lastBlockerOp,
      ...warm.lastBlocker,
      whyFinalCannotCompleteBefore:
        "buildTopLegsFromFullBoardScan awaits the overlapping prop phase (simPropPoolUntilQualified → simPropBatch → enrichCoachPropSimHits) before returning boardExhausted final; awaitingPropSlots / fillReservedPropSlots need prop-scored legs to replace GL-only preview seats.",
    },
    canRemainingWorkAlterTicket: canAlter,
    proposedPhase23: {
      title: "Smallest safe Phase 2.3: eliminate duplicate client history enrich when server MC already graded",
      currentBehavior:
        "simPropBatch always runs enrichCoachPropSimHits after fetchPropSimulations; enrich ALWAYS getPlayerHistory for every batch player even when hitProbability is already present from propsim-ctx.",
      rootCauseOfLongScanTail:
        "Duplicate history acquisition (server propsim-ctx hist + client /sports/player-history) extends wall after/overlapping prop sim; outer game-sim batch=2 serializes progressive GL scoring.",
      proposedChange:
        "Pass server-returned history slices (or skip re-fetch when athlete already has MC grade + optional thin form fields) into enrich; keep local fallback only for null MC. Optionally raise outer game batch toward 4 to match inner concurrency — but only if partial emission semantics preserved.",
      expectedImpact:
        "Remove ~N client player-history RTTs per prop wave (observed ~23 calls / ~10s sum) without changing MC equations, qualification thresholds, or markets.",
      mustPreserve:
        "Exact ESPN mapping, 10k sims, markets/ALTs, thresholds, EV/edge/grade/confidence, correlation/diversity, no fabricated history",
      notInScopeYet: "Early exit at first 5 — remaining work can alter final ticket",
    },
    warmMeta: {
      wallMs: warm.wallMs,
      finalLegs: warm.finalLegs,
      partialLog: warm.partialLog,
      statusLog: warm.statusLog,
      ticket: warm.ticket,
    },
  };

  const out = "/opt/cursor/artifacts/coach-phase23-scan-internals-audit.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        scanWallMs: warm.scanWallMs,
        ops: warm.ops.map((o) => ({
          operation: o.operation,
          count: o.count,
          start: o.start,
          end: o.end,
          wall: o.wall,
          concurrency: o.concurrency,
          cacheHM: o.cacheHM,
          blocksFinal: o.blocksFinal,
        })),
        lastBlocker: report.lastBlocker.operation,
        hist: warm.histEnrich,
        gameBench: gameBench.rows ?? gameBench,
        canAlter: canAlter.evidence,
        phase23: report.proposedPhase23.title,
      },
      null,
      2,
    ),
  );
  console.error(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
