/**
 * Phase 2.3 E2E verification — local runPropSims (returns playerHistories) +
 * production odds/context/game-sim.
 *
 * Reports wall | history | gameSim | propSim | shared/coalesced | qualified | final
 * for fresh 5, repeat 5 (×5), soccer→5, NFL 7.
 */
import { writeFileSync } from "node:fs";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  coachCacheSnapshot,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";
import { runPropSims, tierSimCount } from "../src/lib/propSimRunner.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight, type SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { teamPace } from "../src/lib/statmuse.ts";
import type { SimTier } from "../src/lib/simCache.ts";

const HARD_MS = 300_000;
const FRESH_BASELINE = { min: 26027, median: 29072, mean: 29531, max: 34469 };

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

type RunMetrics = {
  label: string;
  wallMs: number;
  historyProviderCalls: number;
  historyWallMs: number;
  historyCacheHits: number;
  historyCacheMisses: number;
  historyShared: number;
  historyCoalesced: number;
  historyReusedClient: number;
  gameSimWallMs: number;
  gameSimCalls: number;
  propSimWallMs: number;
  propSimElapsedMs: number;
  ctx: string;
  dist: string;
  qualified: number | null;
  finalLegs: number;
  ticket: Array<{ pick: string; isProp: boolean; market?: string }>;
  note: string;
};

type Agg = {
  historyShared: number;
  historyCoalesced: number;
  propSimElapsedMs: number;
  propSimWallMs: number;
  ctxHits: number;
  ctxMisses: number;
  distHits: number;
  distMisses: number;
  historyLoads: number;
};

function emptyAgg(): Agg {
  return {
    historyShared: 0,
    historyCoalesced: 0,
    propSimElapsedMs: 0,
    propSimWallMs: 0,
    ctxHits: 0,
    ctxMisses: 0,
    distHits: 0,
    distMisses: 0,
    historyLoads: 0,
  };
}

async function handleLocalPropSim(body: Record<string, unknown>, agg: Agg) {
  const t0 = performance.now();
  const sport = String(body.sport ?? "").toLowerCase();
  const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
  const props = (body.props ?? []) as SimPropRequest[];
  const homeTeam = String(body.homeTeam ?? "");
  const awayTeam = String(body.awayTeam ?? "");
  const { props: propsResolved } = await resolvePropAthleteIdsDetailed(
    sport,
    props.map((p) => ({ ...p, sport: String(p.sport ?? sport).toLowerCase() })),
    {
      homeTeamId: String(body.homeTeamId ?? "").trim(),
      awayTeamId: String(body.awayTeamId ?? "").trim(),
      homeTeam,
      awayTeam,
    },
  );
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
  const { rows, deepPending, distStats, propSimElapsedMs, playerHistories, historyShared, historyCoalesced } =
    await runPropSims(
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
  agg.propSimElapsedMs += propSimElapsedMs;
  agg.propSimWallMs += Math.round(performance.now() - t0);
  agg.historyShared += historyShared;
  agg.historyCoalesced += historyCoalesced;
  agg.ctxHits += distStats.ctxCacheHits;
  agg.ctxMisses += distStats.ctxCacheMisses;
  agg.distHits += distStats.distributionCacheHits;
  agg.distMisses += distStats.distributionCacheMisses;
  agg.historyLoads += distStats.historyLoads;
  return {
    sport,
    tier,
    simulations: tierSimCount(tier),
    deepPending,
    props: rows,
    playerHistories,
    historyShared,
    historyCoalesced,
    propSimElapsedMs,
    ...distStats,
  };
}

async function runOnce(opts: {
  label: string;
  ask: string;
  priors: string[];
  clearAll: boolean;
}): Promise<RunMetrics> {
  if (opts.clearAll) {
    clearCoachContextCache();
    clearPropSimDedicatedStoresForTests();
    clearAthleteIdentityStoreForTests();
    clearAuthoritativePlayerHistoryForTests();
  }
  resetCoachCacheStats();

  const origin = performance.now();
  const histCalls: Array<{ start: number; end: number }> = [];
  const gameCalls: Array<{ start: number; end: number }> = [];
  const agg = emptyAgg();

  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = String(init?.method ?? "GET").toUpperCase();
    const t0 = performance.now();

    if (url.includes("/sports/simulate/props") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const payload = await handleLocalPropSim(body, agg);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const res = await orig(input, init);
    const t1 = performance.now();
    if (url.includes("/sports/player-history") || url.includes("/player-history")) {
      histCalls.push({ start: Math.round(t0 - origin), end: Math.round(t1 - origin) });
    }
    if (url.includes("/sports/simulate") && !url.includes("/simulate/props")) {
      gameCalls.push({ start: Math.round(t0 - origin), end: Math.round(t1 - origin) });
    }
    return res;
  }) as typeof fetch;

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: opts.ask.includes("7") ? 7 : 5,
      askText: opts.ask,
      priorUserTexts: opts.priors,
      signal: ac.signal,
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }

  const wallMs = Math.round(performance.now() - origin);
  const cache = coachCacheSnapshot();
  const ph = cache.stages.find((s) => s.stage === "playerHistory");
  const histWall =
    histCalls.length > 0
      ? Math.max(...histCalls.map((h) => h.end)) - Math.min(...histCalls.map((h) => h.start))
      : 0;
  const gameWall =
    gameCalls.length > 0
      ? Math.max(...gameCalls.map((g) => g.end)) - Math.min(...gameCalls.map((g) => g.start))
      : 0;

  return {
    label: opts.label,
    wallMs,
    historyProviderCalls: histCalls.length,
    historyWallMs: histWall,
    historyCacheHits: ph?.cacheHit ?? 0,
    historyCacheMisses: ph?.cacheMiss ?? 0,
    historyShared: agg.historyShared,
    historyCoalesced: agg.historyCoalesced,
    historyReusedClient: Math.max(0, (ph?.calls ?? 0) - histCalls.length),
    gameSimWallMs: gameWall,
    gameSimCalls: gameCalls.length,
    propSimWallMs: agg.propSimWallMs,
    propSimElapsedMs: agg.propSimElapsedMs,
    ctx: `${agg.ctxHits}/${agg.ctxMisses}`,
    dist: `${agg.distHits}/${agg.distMisses}`,
    qualified: result.failureDiagnostics?.scoredBeforeStage ?? null,
    finalLegs: result.picks?.length ?? 0,
    ticket: (result.picks ?? []).map((p) => ({
      pick: p.pick,
      isProp: !!p.isProp,
      market: p.market,
    })),
    note: (result.note || "").slice(0, 160),
  };
}

function stats(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  const mean = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
  const median = s[Math.floor(s.length / 2)]!;
  const p95 = s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
  return { n: s.length, min: s[0]!, median, mean, p95, max: s[s.length - 1]! };
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Phase 2.3 E2E (local prop-sim + production board)");

  // Cold prime then scenarios
  const cold5 = await runOnce({ label: "fresh5", ask: "5 leg", priors: [], clearAll: true });
  console.error(`[fresh5] wall=${cold5.wallMs} histCalls=${cold5.historyProviderCalls} histWall=${cold5.historyWallMs} shared=${cold5.historyShared}`);

  // Warm repeat without clearing stores
  await runOnce({ label: "warm-prime", ask: "5 leg", priors: [], clearAll: false });
  const warmRuns: RunMetrics[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await runOnce({ label: `repeat5-${i + 1}`, ask: "5 leg", priors: [], clearAll: false });
    warmRuns.push(r);
    console.error(`[repeat5-${i + 1}] wall=${r.wallMs} histCalls=${r.historyProviderCalls} histWall=${r.historyWallMs}`);
  }

  // Fresh 5 variance (5 clears)
  const freshRuns: RunMetrics[] = [cold5];
  for (let i = 0; i < 4; i++) {
    const r = await runOnce({ label: `fresh5-${i + 2}`, ask: "5 leg", priors: [], clearAll: true });
    freshRuns.push(r);
    console.error(`[fresh5-${i + 2}] wall=${r.wallMs} histCalls=${r.historyProviderCalls}`);
  }

  const soccer = await runOnce({
    label: "soccer-to-5",
    ask: "5 leg",
    priors: ["soccer"],
    clearAll: true,
  });
  console.error(`[soccer→5] wall=${soccer.wallMs} final=${soccer.finalLegs}`);

  const nfl7 = await runOnce({
    label: "nfl-7",
    ask: "7 leg NFL",
    priors: [],
    clearAll: true,
  });
  console.error(`[nfl7] wall=${nfl7.wallMs} final=${nfl7.finalLegs} qualified=${nfl7.qualified}`);

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.3",
    note: "Local prop-sim (Phase 2.3 playerHistories) + production board. No merge/deploy.",
    apiBase: API_BASE,
    freshBaselinePre23: FRESH_BASELINE,
    table: {
      fresh5: cold5,
      repeat5_mean: {
        wallMs: Math.round(warmRuns.reduce((a, r) => a + r.wallMs, 0) / warmRuns.length),
        historyProviderCalls: Math.round(
          warmRuns.reduce((a, r) => a + r.historyProviderCalls, 0) / warmRuns.length,
        ),
        historyWallMs: Math.round(
          warmRuns.reduce((a, r) => a + r.historyWallMs, 0) / warmRuns.length,
        ),
        historyShared: Math.round(warmRuns.reduce((a, r) => a + r.historyShared, 0) / warmRuns.length),
        gameSimWallMs: Math.round(warmRuns.reduce((a, r) => a + r.gameSimWallMs, 0) / warmRuns.length),
        propSimWallMs: Math.round(warmRuns.reduce((a, r) => a + r.propSimWallMs, 0) / warmRuns.length),
        finalLegs: warmRuns[warmRuns.length - 1]?.finalLegs ?? 0,
      },
      soccerTo5: soccer,
      nfl7,
    },
    fresh5Variance: stats(freshRuns.map((r) => r.wallMs)),
    repeat5Variance: stats(warmRuns.map((r) => r.wallMs)),
    freshRuns,
    warmRuns,
    ancestry: {
      pr609: true,
      pr612: true,
    },
  };

  const out = "/opt/cursor/artifacts/coach-phase23-e2e-verify.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    fresh5Variance: report.fresh5Variance,
    repeat5Variance: report.repeat5Variance,
    table: {
      fresh5: {
        wall: cold5.wallMs,
        histWall: cold5.historyWallMs,
        histCalls: cold5.historyProviderCalls,
        histHM: `${cold5.historyCacheHits}/${cold5.historyCacheMisses}`,
        shared: cold5.historyShared,
        coalesced: cold5.historyCoalesced,
        gameSimWall: cold5.gameSimWallMs,
        propSimWall: cold5.propSimWallMs,
        qualified: cold5.qualified,
        final: cold5.finalLegs,
      },
      repeat5: report.table.repeat5_mean,
      soccer: { wall: soccer.wallMs, final: soccer.finalLegs, histCalls: soccer.historyProviderCalls },
      nfl7: { wall: nfl7.wallMs, final: nfl7.finalLegs, qualified: nfl7.qualified },
    },
  }, null, 2));
  console.error(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
