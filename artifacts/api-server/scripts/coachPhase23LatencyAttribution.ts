/**
 * Phase 2.3 follow-up — AUDIT ONLY: remaining latency variance attribution.
 * No production code changes.
 *
 * Separates span vs sum, server compute vs client wait, overlapping intervals.
 * Cold once, then 5 consecutive warm 5-leg runs. NFL 7 shortfall diagnosis.
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

type CallEvt = {
  op: string;
  startMs: number;
  endMs: number;
  wallMs: number;
  detail?: Record<string, unknown>;
};

type PropWave = {
  startMs: number;
  endMs: number;
  wallMs: number;
  propSimElapsedMs: number;
  athleteMs: number;
  injuryMs: number;
  paceMs: number;
  authHistMs: number;
  ctxHits: number;
  ctxMisses: number;
  distHits: number;
  distMisses: number;
  historyLoads: number;
  historyShared: number;
  historyCoalesced: number;
  scored: number;
  propsIn: number;
};

function spanOf(evts: Array<{ startMs: number; endMs: number }>): {
  start: number;
  end: number;
  wall: number;
} {
  if (!evts.length) return { start: -1, end: -1, wall: 0 };
  const start = Math.min(...evts.map((e) => e.startMs));
  const end = Math.max(...evts.map((e) => e.endMs));
  return { start, end, wall: end - start };
}

function sumOf(evts: Array<{ wallMs: number }>): number {
  return evts.reduce((a, e) => a + e.wallMs, 0);
}

async function runAttributed(opts: {
  label: string;
  ask: string;
  priors: string[];
  clearAll: boolean;
  captureFailureDiag?: boolean;
}) {
  if (opts.clearAll) {
    clearCoachContextCache();
    clearPropSimDedicatedStoresForTests();
    clearAthleteIdentityStoreForTests();
    clearAuthoritativePlayerHistoryForTests();
  }
  resetCoachCacheStats();

  const origin = performance.now();
  const httpEvts: CallEvt[] = [];
  const propWaves: PropWave[] = [];
  const statusLog: Array<{ t: number; status: string }> = [];
  const partialLog: Array<{ t: number; picks: number; props: number }> = [];

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
      const sport = String(body.sport ?? "").toLowerCase();
      const tier = (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier;
      const props = (body.props ?? []) as SimPropRequest[];
      const homeTeam = String(body.homeTeam ?? "");
      const awayTeam = String(body.awayTeam ?? "");

      const tAth0 = performance.now();
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
      const athleteMs = Math.round(performance.now() - tAth0);

      const tInj0 = performance.now();
      const injuries = await fetchEspnInjuries(sport);
      const injuryMs = Math.round(performance.now() - tInj0);

      let oppPace: number | null = null;
      let leaguePace: number | null = 100;
      let paceMs = 0;
      if ((sport === "nba" || sport === "wnba") && homeTeam && awayTeam) {
        const tP0 = performance.now();
        try {
          const [a, b] = await Promise.all([teamPace(sport, homeTeam), teamPace(sport, awayTeam)]);
          if (a != null && b != null) {
            oppPace = (a + b) / 2;
            leaguePace = 100;
          }
        } catch {
          /* optional */
        }
        paceMs = Math.round(performance.now() - tP0);
      }

      const tSim0 = performance.now();
      const {
        rows,
        deepPending,
        distStats,
        propSimElapsedMs,
        playerHistories,
        historyShared,
        historyCoalesced,
      } = await runPropSims(
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
      // auth hist projection is inside runPropSims after MC — included in propSimElapsedMs
      const t1 = performance.now();
      const wallMs = Math.round(t1 - t0);
      propWaves.push({
        startMs: Math.round(t0 - origin),
        endMs: Math.round(t1 - origin),
        wallMs,
        propSimElapsedMs,
        athleteMs,
        injuryMs,
        paceMs,
        authHistMs: Math.max(0, wallMs - athleteMs - injuryMs - paceMs - propSimElapsedMs),
        ctxHits: distStats.ctxCacheHits,
        ctxMisses: distStats.ctxCacheMisses,
        distHits: distStats.distributionCacheHits,
        distMisses: distStats.distributionCacheMisses,
        historyLoads: distStats.historyLoads,
        historyShared,
        historyCoalesced,
        scored: rows.filter((r) => r.hitProbability != null).length,
        propsIn: props.length,
      });
      httpEvts.push({
        op: "prop_simulation",
        startMs: Math.round(t0 - origin),
        endMs: Math.round(t1 - origin),
        wallMs,
        detail: {
          propSimElapsedMs,
          athleteMs,
          injuryMs,
          ctx: `${distStats.ctxCacheHits}/${distStats.ctxCacheMisses}`,
          dist: `${distStats.distributionCacheHits}/${distStats.distributionCacheMisses}`,
          historyLoads: distStats.historyLoads,
          historyShared,
        },
      });
      return new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const res = await orig(input, init);
    const t1 = performance.now();
    const startMs = Math.round(t0 - origin);
    const endMs = Math.round(t1 - origin);
    const wallMs = endMs - startMs;
    let op = "other";
    if (url.includes("/sports/player-history")) op = "player_history";
    else if (url.includes("/sports/simulate") && !url.includes("/simulate/props"))
      op = "game_simulation";
    else if (url.includes("/sports/props")) op = "prop_discovery";
    else if (url.includes("/sports/odds")) op = "board_odds";
    else if (url.includes("/live-odds")) op = "live_odds";
    else if (url.includes("/sports/games")) op = "espn_games";
    else if (url.includes("/injuries")) op = "injuries";
    else if (url.includes("/weather") || url.includes("/park")) op = "weather";
    else if (url.includes("/team-period")) op = "team_period_stats";
    else if (url.includes("/mlb")) op = "mlb_context";
    httpEvts.push({
      op,
      startMs,
      endMs,
      wallMs,
      detail: { status: res.status, url: url.slice(0, 120) },
    });
    return res;
  }) as typeof fetch;

  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: opts.ask.toLowerCase().includes("7") ? 7 : 5,
      askText: opts.ask,
      priorUserTexts: opts.priors,
      signal: ac.signal,
      onStatus: (status) => statusLog.push({ t: Math.round(performance.now() - origin), status }),
      onPartialPicks: (picks) =>
        partialLog.push({
          t: Math.round(performance.now() - origin),
          picks: picks.length,
          props: picks.filter((p) => p.isProp).length,
        }),
    });
  } finally {
    clearTimeout(kill);
    globalThis.fetch = orig;
  }

  const wallMs = Math.round(performance.now() - origin);
  const cache = coachCacheSnapshot();
  const byOp = (op: string) => httpEvts.filter((e) => e.op === op);
  const hist = byOp("player_history");
  const game = byOp("game_simulation");
  const histSpan = spanOf(hist);
  const gameSpan = spanOf(game);
  const propSpan = spanOf(propWaves);
  const gameCache = cache.stages.find((s) => s.stage === "gameSimulation");
  const histCache = cache.stages.find((s) => s.stage === "playerHistory");

  const ctxHits = propWaves.reduce((a, w) => a + w.ctxHits, 0);
  const ctxMisses = propWaves.reduce((a, w) => a + w.ctxMisses, 0);
  const distHits = propWaves.reduce((a, w) => a + w.distHits, 0);
  const distMisses = propWaves.reduce((a, w) => a + w.distMisses, 0);

  // Overlap between gameSim span and propSim span
  const overlapMs =
    propSpan.wall > 0 && gameSpan.wall > 0
      ? Math.max(0, Math.min(propSpan.end, gameSpan.end) - Math.max(propSpan.start, gameSpan.start))
      : 0;

  const opsTable = [
    {
      operation: "player_history",
      calls: hist.length,
      cacheHM: `${histCache?.cacheHit ?? 0}/${histCache?.cacheMiss ?? 0}`,
      generated: 0,
      providerNetworkSumMs: sumOf(hist),
      serverComputeMs: null,
      clientWaitSpanMs: histSpan.wall,
      start: histSpan.start,
      end: histSpan.end,
      note: "client→API /sports/player-history (early board context + enrich fallback)",
    },
    {
      operation: "game_simulation",
      calls: game.length,
      cacheHM: `${gameCache?.cacheHit ?? 0}/${gameCache?.cacheMiss ?? 0}`,
      generated: gameCache?.cacheMiss ?? game.length,
      providerNetworkSumMs: sumOf(game),
      serverComputeMs: null,
      clientWaitSpanMs: gameSpan.wall,
      start: gameSpan.start,
      end: gameSpan.end,
      note: "SPAN is serial outer batches overlapping other work; SUM is true HTTP cost. Client fingerprint cache H/M separate.",
    },
    {
      operation: "prop_simulation",
      calls: propWaves.length,
      cacheHM: `ctx ${ctxHits}/${ctxMisses}; dist ${distHits}/${distMisses}`,
      generated: distMisses,
      providerNetworkSumMs: sumOf(propWaves.map((w) => ({ wallMs: w.wallMs }))),
      serverComputeMs: propWaves.reduce((a, w) => a + w.propSimElapsedMs, 0),
      clientWaitSpanMs: propSpan.wall,
      start: propSpan.start,
      end: propSpan.end,
      note: "SUM of wave walls ≠ critical-path add when waves are sequential; SPAN is first→last wave. propSimElapsedMs = inside runPropSims.",
      waves: propWaves,
    },
  ];

  return {
    label: opts.label,
    wallMs,
    opsTable,
    propWaves,
    gameHttp: game,
    histHttp: hist,
    overlapGamePropMs: overlapMs,
    ctx: `${ctxHits}/${ctxMisses}`,
    dist: `${distHits}/${distMisses}`,
    gameSimHM: `${gameCache?.cacheHit ?? 0}/${gameCache?.cacheMiss ?? 0}`,
    histHM: `${histCache?.cacheHit ?? 0}/${histCache?.cacheMiss ?? 0}`,
    // Convenience scalars (SPAN for game/hist, SUM of propSimElapsed for prop — see attribution)
    histSpanMs: histSpan.wall,
    histCalls: hist.length,
    gameSimSpanMs: gameSpan.wall,
    gameSimSumMs: sumOf(game),
    gameSimCalls: game.length,
    propSimSpanMs: propSpan.wall,
    propSimSumWallMs: sumOf(propWaves.map((w) => ({ wallMs: w.wallMs }))),
    propSimSumElapsedMs: propWaves.reduce((a, w) => a + w.propSimElapsedMs, 0),
    propSimWaves: propWaves.length,
    finalLegs: result.picks?.length ?? 0,
    ticket: (result.picks ?? []).map((p) => ({
      pick: p.pick,
      isProp: !!p.isProp,
      market: p.market,
      grade: p.finalAiScore?.grade ?? p.scores?.grade ?? null,
      edge: p.finalAiScore?.edge ?? null,
      ev: p.finalAiScore?.ev ?? null,
      simHit: p.finalAiScore?.simHit ?? null,
    })),
    failureDiagnostics: opts.captureFailureDiag ? result.failureDiagnostics ?? null : null,
    staging: (result as { stagingSummary?: unknown }).stagingSummary ?? null,
    note: (result.note || "").slice(0, 240),
    statusLog,
    partialLog,
    attribution: {
      gameSimLargeValueIs:
        gameSpan.wall > 5_000 && sumOf(game) < gameSpan.wall * 0.3
          ? "mostly_overlapping_serial_batch_span_not_provider_sum"
          : game.length === 0
            ? "client_cache_hits_no_http"
            : "provider_http_and_or_serial_batches",
      propSimLargeValueIs:
        propWaves.length > 1 &&
        propWaves.reduce((a, w) => a + w.propSimElapsedMs, 0) >
          Math.max(...propWaves.map((w) => w.propSimElapsedMs)) * 1.5
          ? "sum_of_sequential_waves_not_single_compute"
          : distMisses > 0
            ? "includes_dist_generation_cache_miss"
            : ctxMisses > 0
              ? "includes_ctx_history_miss_work"
              : "cached_path_or_other_wait_inside_waves",
    },
  };
}

function stats(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0]!,
    median: s[Math.floor(s.length / 2)]!,
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!,
    max: s[s.length - 1]!,
  };
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Phase 2.3 remaining-latency attribution audit");

  const cold = await runAttributed({
    label: "cold",
    ask: "5 leg",
    priors: [],
    clearAll: true,
  });
  console.error(
    `[cold] wall=${cold.wallMs} gameSpan=${cold.gameSimSpanMs} gameSum=${cold.gameSimSumMs} propSpan=${cold.propSimSpanMs} propSumEl=${cold.propSimSumElapsedMs} waves=${cold.propSimWaves} overlap=${cold.overlapGamePropMs}`,
  );

  const runs = [];
  for (let i = 1; i <= 5; i++) {
    const r = await runAttributed({
      label: `warm-${i}`,
      ask: "5 leg",
      priors: [],
      clearAll: false,
    });
    runs.push(r);
    console.error(
      `[warm-${i}] wall=${r.wallMs} hist=${r.histSpanMs}/${r.histCalls} gameSpan=${r.gameSimSpanMs} gameSum=${r.gameSimSumMs} gameHM=${r.gameSimHM} propSpan=${r.propSimSpanMs} propSumEl=${r.propSimSumElapsedMs} waves=${r.propSimWaves} ctx=${r.ctx} dist=${r.dist} final=${r.finalLegs}`,
    );
    for (const w of r.propWaves) {
      console.error(
        `  wave wall=${w.wallMs} elapsed=${w.propSimElapsedMs} ath=${w.athleteMs} inj=${w.injuryMs} ctx=${w.ctxHits}/${w.ctxMisses} dist=${w.distHits}/${w.distMisses} histLoads=${w.historyLoads} scored=${w.scored}/${w.propsIn}`,
      );
    }
  }

  const nfl7 = await runAttributed({
    label: "nfl-7",
    ask: "7 leg NFL",
    priors: [],
    clearAll: true,
    captureFailureDiag: true,
  });
  console.error(
    `[nfl7] wall=${nfl7.wallMs} final=${nfl7.finalLegs} diag=${JSON.stringify(nfl7.failureDiagnostics)}`,
  );

  // Pick representative fresh (cold) + warm (median wall run) for ops tables
  const warmSorted = [...runs].sort((a, b) => a.wallMs - b.wallMs);
  const warmMedian = warmSorted[Math.floor(warmSorted.length / 2)]!;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.3-remaining-latency-attribution",
    note: "AUDIT ONLY — no optimizations. propSimSum* sums sequential waves; gameSimSpan is serial-batch overlap window.",
    whyCriticalPathMoves: {
      fresh: {
        dominantReported: "gameSim span",
        actual: "Serial SLATE_SIM_BATCH outer loop spans ~scan while props overlap; HTTP SUM is much smaller than SPAN when most games are cache-miss progressive. Prop-sim waves are short when ctx/dist cold-path finishes early relative to game batch span.",
        evidence: {
          gameSimSpanMs: cold.gameSimSpanMs,
          gameSimSumMs: cold.gameSimSumMs,
          propSimSpanMs: cold.propSimSpanMs,
          propSimSumElapsedMs: cold.propSimSumElapsedMs,
          overlapGamePropMs: cold.overlapGamePropMs,
          attribution: cold.attribution,
        },
      },
      repeat: {
        dominantReported: "propSim wall (prior mean ~10.7s)",
        actual: "Prior bench SUMMED propSimWall across waves and across the mean of runs. Warm run1 often has hot caches (propSim ~ms) while later runs can issue new deep-sim waves for different candidates (ctx miss / new athletes) OR sum multiple sequential waves. gameSim HTTP often 0 (client fingerprint cache) so SPAN=0 and critical path appears to 'move' to propSim.",
        evidence: {
          perRun: runs.map((r) => ({
            label: r.label,
            wall: r.wallMs,
            gameSpan: r.gameSimSpanMs,
            gameSum: r.gameSimSumMs,
            gameCalls: r.gameSimCalls,
            gameHM: r.gameSimHM,
            propSpan: r.propSimSpanMs,
            propSumElapsed: r.propSimSumElapsedMs,
            propSumWall: r.propSimSumWallMs,
            waves: r.propSimWaves,
            ctx: r.ctx,
            dist: r.dist,
            maxSingleWaveElapsed: r.propWaves.length
              ? Math.max(...r.propWaves.map((w) => w.propSimElapsedMs))
              : 0,
          })),
        },
      },
    },
    freshOps: cold.opsTable,
    repeatOps: warmMedian.opsTable,
    consecutiveWarm: {
      afterCold: true,
      runs: runs.map((r) => ({
        run: r.label,
        totalWall: r.wallMs,
        hist: r.histSpanMs,
        histCalls: r.histCalls,
        gameSimSpan: r.gameSimSpanMs,
        gameSimSum: r.gameSimSumMs,
        propSimSpan: r.propSimSpanMs,
        propSimSumElapsed: r.propSimSumElapsedMs,
        propSimSumWall: r.propSimSumWallMs,
        propWaves: r.propSimWaves,
        maxWaveElapsed: r.propWaves.length
          ? Math.max(...r.propWaves.map((w) => w.propSimElapsedMs))
          : 0,
        ctxHM: r.ctx,
        distHM: r.dist,
        gameSimHM: r.gameSimHM,
        final: r.finalLegs,
      })),
      statsTotal: stats(runs.map((r) => r.wallMs)),
      statsPropSumElapsed: stats(runs.map((r) => r.propSimSumElapsedMs)),
      statsPropMaxWave: stats(
        runs.map((r) =>
          r.propWaves.length ? Math.max(...r.propWaves.map((w) => w.propSimElapsedMs)) : 0,
        ),
      ),
      statsGameSpan: stats(runs.map((r) => r.gameSimSpanMs)),
    },
    nfl7: {
      wallMs: nfl7.wallMs,
      requested: 7,
      final: nfl7.finalLegs,
      ticket: nfl7.ticket,
      failureDiagnostics: nfl7.failureDiagnostics,
      note: nfl7.note,
      partialLog: nfl7.partialLog,
    },
    cold,
    warmRuns: runs,
  };

  const out = "/opt/cursor/artifacts/coach-phase23-latency-attribution.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        whyMoves: report.whyCriticalPathMoves,
        consecutive: report.consecutiveWarm.runs,
        stats: {
          total: report.consecutiveWarm.statsTotal,
          propSumElapsed: report.consecutiveWarm.statsPropSumElapsed,
          propMaxWave: report.consecutiveWarm.statsPropMaxWave,
          gameSpan: report.consecutiveWarm.statsGameSpan,
        },
        nfl7: {
          final: nfl7.finalLegs,
          diag: nfl7.failureDiagnostics,
          ticket: nfl7.ticket,
        },
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
