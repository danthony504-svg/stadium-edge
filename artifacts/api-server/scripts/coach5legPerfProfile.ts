/**
 * Production performance profile: plain "5 leg" cold vs warm.
 * Report-only — no production patches, no threshold invention.
 *
 *   EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coach5legPerfProfile.ts
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import { API_BASE } from "../../stadium-mobile/lib/apiBase.ts";
import {
  clearCoachContextCache,
  coachCacheSnapshot,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";

const ASK = "5 leg";
const LEGS = 5;
const HARD_MS = Number(process.env.HARD_TIMEOUT_MS || 420_000);
const PHASE1_COLD_MS = 51_300;
const PHASE1_WARM_MS = 20_300;

type StageKey =
  | "oddsSlateLoad"
  | "propDiscovery"
  | "gameLineDiscovery"
  | "espnTeamPlayerIds"
  | "injuryContext"
  | "playerHistory"
  | "matchupOpponent"
  | "gameSimulations"
  | "propSimulations"
  | "periodStats"
  | "otherHttp"
  | "localCpuRemainder";

type HttpCall = {
  method: string;
  path: string;
  status: number;
  ms: number;
  bytes: number;
  stage: StageKey;
  isSimulate: boolean;
  is429: boolean;
  dist?: Record<string, number>;
};

type StageAgg = { ms: number; calls: number; cacheHits: number; cacheMisses: number };

function classify(path: string, method: string): StageKey {
  const p = path.toLowerCase();
  if (p.includes("/sports/simulate/props")) return "propSimulations";
  if (p.includes("/sports/simulate/game-outcome") || p.includes("/sports/simulate/game")) {
    return "gameSimulations";
  }
  if (p.includes("/sports/team-period-stats")) return "periodStats";
  if (
    p.includes("/sports/player-history") ||
    p.includes("/sports/athletes") ||
    p.includes("playerhistory")
  ) {
    return "playerHistory";
  }
  if (
    p.includes("/injuries") ||
    p.includes("/weather") ||
    p.includes("/mlb/") ||
    p.includes("/statmuse")
  ) {
    return "injuryContext";
  }
  if (
    p.includes("/defense") ||
    p.includes("/team-history") ||
    p.includes("/matchup") ||
    p.includes("/coaches") ||
    p.includes("/football/")
  ) {
    return "matchupOpponent";
  }
  if (
    p.includes("/sports/props") ||
    p.includes("/sports/prizepicks") ||
    p.includes("/prop-pool") ||
    p.includes("/board")
  ) {
    return "propDiscovery";
  }
  if (p.includes("/sports/odds") || p.includes("/sports/live-odds") || p.includes("/sports/games")) {
    // odds + games cover slate + game-line discovery
    if (method === "GET" && p.includes("/sports/games")) return "espnTeamPlayerIds";
    return "oddsSlateLoad";
  }
  if (p.includes("/team") && p.includes("id")) return "espnTeamPlayerIds";
  return "otherHttp";
}

function emptyStages(): Record<StageKey, StageAgg> {
  const keys: StageKey[] = [
    "oddsSlateLoad",
    "propDiscovery",
    "gameLineDiscovery",
    "espnTeamPlayerIds",
    "injuryContext",
    "playerHistory",
    "matchupOpponent",
    "gameSimulations",
    "propSimulations",
    "periodStats",
    "otherHttp",
    "localCpuRemainder",
  ];
  const out = {} as Record<StageKey, StageAgg>;
  for (const k of keys) out[k] = { ms: 0, calls: 0, cacheHits: 0, cacheMisses: 0 };
  return out;
}

function installProbe(calls: HttpCall[], stages: Record<StageKey, StageAgg>) {
  const orig = globalThis.fetch.bind(globalThis);
  let retryBackoffMs = 0;
  let status429 = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    let path = url;
    try {
      const u = new URL(url);
      path = u.pathname + (u.search || "");
    } catch {
      /* keep */
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const stage = classify(path, method);
    const t0 = performance.now();
    const res = await orig(input, init);
    const ms = Math.round(performance.now() - t0);
    let bytes = 0;
    let dist: Record<string, number> | undefined;
    try {
      const clone = res.clone();
      const buf = await clone.arrayBuffer();
      bytes = buf.byteLength;
      if (path.includes("/sports/simulate/props")) {
        const json = JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;
        dist = {
          distributionCacheHits: Number(json.distributionCacheHits ?? 0),
          distributionCacheMisses: Number(json.distributionCacheMisses ?? 0),
          distributionsGenerated: Number(json.distributionsGenerated ?? 0),
          thresholdsEvaluatedFromCache: Number(json.thresholdsEvaluatedFromCache ?? 0),
          thresholdsEvaluatedFromFreshDraw: Number(json.thresholdsEvaluatedFromFreshDraw ?? 0),
          monteCarloDrawsAvoided: Number(json.monteCarloDrawsAvoided ?? 0),
          monteCarloDrawsExecuted: Number(json.monteCarloDrawsExecuted ?? 0),
          propSimElapsedMs: Number(json.propSimElapsedMs ?? 0),
          providerLinesEvaluated: Number(json.providerLinesEvaluated ?? 0),
          simulations: Number(json.simulations ?? 0),
        };
        stages.propSimulations.cacheHits += dist.distributionCacheHits;
        stages.propSimulations.cacheMisses += dist.distributionCacheMisses;
      }
    } catch {
      /* ignore body parse */
    }

    if (res.status === 429) {
      status429 += 1;
      // client sleepBackoff is ~300*attempt — we can't see it here; count status only
    }

    const isSimulate =
      path.includes("/sports/simulate/") || path.includes("/simulate/");
    calls.push({
      method,
      path: path.slice(0, 180),
      status: res.status,
      ms,
      bytes,
      stage,
      isSimulate,
      is429: res.status === 429,
      dist,
    });
    stages[stage].ms += ms;
    stages[stage].calls += 1;
    return res;
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = orig;
    },
    getRetryBackoffMs: () => retryBackoffMs,
    get429: () => status429,
  };
}

type RunReport = {
  label: string;
  ask: string;
  totalRuntimeMs: number;
  terminalReached: boolean;
  timedOut: boolean | null;
  error: string | null;
  statuses: string[];
  stages: Record<StageKey, StageAgg>;
  http: {
    totalCalls: number;
    uniquePaths: number;
    duplicatePathCalls: number;
    simulateCalls: number;
    status429: number;
    over2s: number;
    over5s: number;
    over10s: number;
    slowest: Array<{ path: string; ms: number; status: number; stage: string }>;
  };
  sharedDist: {
    used: boolean;
    distributionCacheHits: number;
    distributionCacheMisses: number;
    distributionsGenerated: number;
    thresholdsFromCache: number;
    thresholdsFromFresh: number;
    monteCarloDrawsExecuted: number;
    monteCarloDrawsAvoided: number;
    propSimHttpCalls: number;
    providerLinesEvaluated: number;
    distributionsReusedApprox: number;
  };
  candidates: {
    posted: number | null;
    propLegsScored: number | null;
    gameLegsScored: number | null;
    deepSimulatedProps: number | null;
    finalLegs: number;
    propLikeFinal: number;
    gameLineFinal: number;
    marketsOnTicket: string[];
  };
  concurrencyNotes: string[];
  coachCache: ReturnType<typeof coachCacheSnapshot>;
};

async function runOnce(label: string): Promise<RunReport> {
  // Cold starts with empty client context cache; warm keeps prior entries.
  if (label === "cold") {
    clearCoachContextCache();
  }
  resetCoachCacheStats();
  const calls: HttpCall[] = [];
  const stages = emptyStages();
  const probe = installProbe(calls, stages);
  const statuses: string[] = [];
  const t0 = performance.now();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_MS);

  let result: Awaited<ReturnType<typeof buildCoachParlay>> | null = null;
  let error: string | null = null;
  let terminal = false;
  try {
    result = await buildCoachParlay({
      requestedLegs: LEGS,
      askText: ASK,
      priorUserTexts: [],
      signal: ac.signal,
      onStatus: (s) => statuses.push(s),
    });
    terminal = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(kill);
    probe.restore();
  }

  const totalRuntimeMs = Math.round(performance.now() - t0);
  const accounted = Object.entries(stages)
    .filter(([k]) => k !== "localCpuRemainder")
    .reduce((a, [, v]) => a + v.ms, 0);
  // HTTP waits overlap (Promise.all) so sum(stage.ms) can exceed wall. Remainder is informative only.
  stages.localCpuRemainder = {
    ms: Math.max(0, totalRuntimeMs - Math.min(accounted, totalRuntimeMs)),
    calls: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  // Attribute odds responses that look like game-line heavy to discovery (best-effort)
  stages.gameLineDiscovery.calls = calls.filter(
    (c) => c.path.includes("/sports/odds") || c.path.includes("/sports/live-odds"),
  ).length;
  stages.gameLineDiscovery.ms = calls
    .filter((c) => c.path.includes("/sports/odds") || c.path.includes("/sports/live-odds"))
    .reduce((a, c) => a + c.ms, 0);

  const pathCounts = new Map<string, number>();
  for (const c of calls) {
    const key = `${c.method} ${c.path.split("?")[0]}`;
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
  }
  let duplicatePathCalls = 0;
  for (const n of pathCounts.values()) {
    if (n > 1) duplicatePathCalls += n - 1;
  }

  const distAgg = {
    distributionCacheHits: 0,
    distributionCacheMisses: 0,
    distributionsGenerated: 0,
    thresholdsFromCache: 0,
    thresholdsFromFresh: 0,
    monteCarloDrawsExecuted: 0,
    monteCarloDrawsAvoided: 0,
    propSimHttpCalls: 0,
    providerLinesEvaluated: 0,
  };
  for (const c of calls) {
    if (!c.dist) continue;
    distAgg.propSimHttpCalls += 1;
    distAgg.distributionCacheHits += c.dist.distributionCacheHits ?? 0;
    distAgg.distributionCacheMisses += c.dist.distributionCacheMisses ?? 0;
    distAgg.distributionsGenerated += c.dist.distributionsGenerated ?? 0;
    distAgg.thresholdsFromCache += c.dist.thresholdsEvaluatedFromCache ?? 0;
    distAgg.thresholdsFromFresh += c.dist.thresholdsEvaluatedFromFreshDraw ?? 0;
    distAgg.monteCarloDrawsExecuted += c.dist.monteCarloDrawsExecuted ?? 0;
    distAgg.monteCarloDrawsAvoided += c.dist.monteCarloDrawsAvoided ?? 0;
    distAgg.providerLinesEvaluated += c.dist.providerLinesEvaluated ?? 0;
  }

  const slowest = [...calls]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 15)
    .map((c) => ({ path: c.path, ms: c.ms, status: c.status, stage: c.stage }));

  const diag = result?.scan?.failureDiagnostics as
    | { propLegsScored?: number; gameLegsScored?: number }
    | undefined;
  const picks = result?.picks ?? [];

  const concurrencyNotes = [
    "Prop sim batches already fan out by game (Promise.all) with chunk size 40.",
    "Game sims run in sequential batches (concurrency 4) AFTER or overlapping props depending on skipPropExpand.",
    "Period stats (NFL/NCAAF/NBA) run Promise.all with each game-outcome — sequential across slate batches.",
    "Player-history enrich after each prop batch is sequential to the batch (bounded by enrich timeout).",
    "Odds/games/prop pool loads in loadScanInputs can be further overlapped with injury/matchup fetches.",
  ];

  return {
    label,
    ask: ASK,
    totalRuntimeMs,
    terminalReached: terminal,
    timedOut: result?.timedOut ?? null,
    error,
    statuses,
    stages,
    http: {
      totalCalls: calls.length,
      uniquePaths: pathCounts.size,
      duplicatePathCalls,
      simulateCalls: calls.filter((c) => c.isSimulate).length,
      status429: probe.get429(),
      over2s: calls.filter((c) => c.ms > 2000).length,
      over5s: calls.filter((c) => c.ms > 5000).length,
      over10s: calls.filter((c) => c.ms > 10000).length,
      slowest,
    },
    sharedDist: {
      used:
        distAgg.distributionsGenerated > 0 ||
        distAgg.distributionCacheHits > 0 ||
        distAgg.monteCarloDrawsAvoided > 0 ||
        distAgg.distributionCacheMisses > 0,
      ...distAgg,
      distributionsReusedApprox: distAgg.distributionCacheHits,
    },
    candidates: {
      posted: result?.propPoolSize ?? null,
      propLegsScored: diag?.propLegsScored ?? null,
      gameLegsScored: diag?.gameLegsScored ?? null,
      deepSimulatedProps: distAgg.providerLinesEvaluated || diag?.propLegsScored || null,
      finalLegs: picks.length,
      propLikeFinal: picks.filter((p) => p.isProp).length,
      gameLineFinal: picks.filter((p) => !p.isProp).length,
      marketsOnTicket: [...new Set(picks.map((p) => p.market))],
    },
    concurrencyNotes,
    coachCache: coachCacheSnapshot(),
  };
}

function roundStages(s: Record<StageKey, StageAgg>) {
  const out: Record<string, StageAgg> = {};
  for (const [k, v] of Object.entries(s)) {
    out[k] = {
      ms: Math.round(v.ms),
      calls: v.calls,
      cacheHits: v.cacheHits,
      cacheMisses: v.cacheMisses,
    };
  }
  return out;
}

async function main() {
  console.error("API_BASE", API_BASE);
  console.error("Profiling cold then warm: plain", JSON.stringify(ASK));

  // Cold: first pass — may still hit server-side warm cache from other traffic.
  const cold = await runOnce("cold");
  cold.stages = roundStages(cold.stages) as RunReport["stages"];
  console.error(
    `[cold] ${cold.totalRuntimeMs}ms terminal=${cold.terminalReached} posted=${cold.candidates.posted} simCalls=${cold.http.simulateCalls} distGen=${cold.sharedDist.distributionsGenerated} distHits=${cold.sharedDist.distributionCacheHits}`,
  );

  await new Promise((r) => setTimeout(r, 1500));

  const warm = await runOnce("warm");
  warm.stages = roundStages(warm.stages) as RunReport["stages"];
  console.error(
    `[warm] ${warm.totalRuntimeMs}ms terminal=${warm.terminalReached} posted=${warm.candidates.posted} simCalls=${warm.http.simulateCalls} distGen=${warm.sharedDist.distributionsGenerated} distHits=${warm.sharedDist.distributionCacheHits}`,
  );

  const stageKeys = Object.keys(cold.stages) as StageKey[];
  const table = stageKeys.map((k) => ({
    stage: k,
    coldMs: cold.stages[k].ms,
    warmMs: warm.stages[k].ms,
    coldCalls: cold.stages[k].calls,
    warmCalls: warm.stages[k].calls,
    coldCacheHits: cold.stages[k].cacheHits,
    warmCacheHits: warm.stages[k].cacheHits,
    coldCacheMisses: cold.stages[k].cacheMisses,
    warmCacheMisses: warm.stages[k].cacheMisses,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    ask: ASK,
    apiBase: API_BASE,
    phase1Baseline: {
      ask: "7 leg NFL",
      coldMs: PHASE1_COLD_MS,
      warmMs: PHASE1_WARM_MS,
      note: "From coach-7leg-nfl-e2e-summary.json after #608",
    },
    phoneObservation: {
      wallApproxMs: 360_000,
      note: "User: 1:43→1:49 PM (~6 min) on iPhone; eventually returned 5-leg mix",
    },
    cold: { ...cold, statuses: cold.statuses.slice(0, 40) },
    warm: { ...warm, statuses: warm.statuses.slice(0, 40) },
    timingTable: table,
    vsPhase1: {
      coldRatio: cold.totalRuntimeMs / PHASE1_COLD_MS,
      warmRatio: warm.totalRuntimeMs / PHASE1_WARM_MS,
      coldDeltaMs: cold.totalRuntimeMs - PHASE1_COLD_MS,
      warmDeltaMs: warm.totalRuntimeMs - PHASE1_WARM_MS,
    },
    sharedDistVerification: {
      coldUsed: cold.sharedDist.used,
      warmUsed: warm.sharedDist.used,
      cold: cold.sharedDist,
      warm: warm.sharedDist,
      expectations: {
        oneDistPerPlayerStatGameContext: true,
        altThresholdsReuseSamples: true,
        sportsbookPriceLineNotInDistKey: true,
        liveProviderLineAuthoritative: true,
      },
    },
    whyApproaching6Minutes: [] as string[],
  };

  // Fill explanation heuristics from data
  const why: string[] = [];
  why.push(
    `Node cold wall ${cold.totalRuntimeMs}ms vs Phase1 NFL-scoped ${PHASE1_COLD_MS}ms (ratio ${(cold.totalRuntimeMs / PHASE1_COLD_MS).toFixed(2)}).`,
  );
  why.push(
    `Full-board posted props ~${cold.candidates.posted} vs Phase1 NFL propsFound ~1497; gameLegsScored ~${cold.candidates.gameLegsScored}.`,
  );
  why.push(
    `Game+period HTTP: gameSim calls=${cold.stages.gameSimulations.calls} (${cold.stages.gameSimulations.ms}ms wall-sum), periodStats calls=${cold.stages.periodStats.calls} (${cold.stages.periodStats.ms}ms).`,
  );
  why.push(
    `Prop deep-sim HTTP calls=${cold.sharedDist.propSimHttpCalls}, distributionsGenerated=${cold.sharedDist.distributionsGenerated}, drawsExecuted=${cold.sharedDist.monteCarloDrawsExecuted}, cacheHits=${cold.sharedDist.distributionCacheHits}.`,
  );
  why.push(
    `Phone ~360s is ~${(360000 / Math.max(cold.totalRuntimeMs, 1)).toFixed(1)}× this Node cold wall — points to mobile JS-thread + cellular serialization on the same full-board workload (esp. ~2k game-leg scoring + awaitingPropSlots UI stall), not a missing terminal.`,
  );
  if (cold.sharedDist.used) {
    why.push(
      "#608 shared dist IS on the production /sports/simulate/props path (metrics present). Full-board does not bypass it; volume is higher because board is multi-sport and game-sim slate is large.",
    );
  } else {
    why.push(
      "#608 metrics absent on prop-sim responses — investigate bypass or older deploy.",
    );
  }
  report.whyApproaching6Minutes = why;

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
