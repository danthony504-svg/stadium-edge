/**
 * Phase 2.4 AUDIT ONLY — profile synchronous local game-sim CPU.
 *
 * No production changes. No optimizations implemented.
 * No merge / deploy / OTA / EAS.
 *
 * Run:
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coachPhase24SimGameCpuAudit.ts
 */
import { writeFileSync } from "node:fs";
import inspector from "node:inspector";
import { performance } from "node:perf_hooks";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  fingerprintCoachGameSim,
  getCoachCacheStats,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import {
  deriveCoverHitRatesFromOutcomes,
  type CoachGameSimEntry,
  type GameCoverQuery,
} from "../../stadium-mobile/lib/gameSimScoring.ts";
import { runGameMonteCarlo } from "../src/lib/gameMonteCarlo.ts";

const HARD_MS = 300_000;
const COACH_GAME_SIMS = 10_000;

type GameOutcomePost = {
  sport: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeam?: string;
  awayTeam?: string;
  simulations: number;
  coverQueries: GameCoverQuery[];
  retainOutcomes?: boolean;
};

type CpuHot = { functionName: string; url: string; line: number; selfMs: number };

function summarizeCpuProfile(profile: inspector.Profiler.Profile, topN = 30): CpuHot[] {
  const nodes = profile.nodes ?? [];
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];
  const selfUs = new Map<number, number>();
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i]!;
    selfUs.set(id, (selfUs.get(id) ?? 0) + (timeDeltas[i] ?? 0));
  }
  const byKey = new Map<string, CpuHot>();
  for (const node of nodes) {
    const us = selfUs.get(node.id) ?? 0;
    if (us <= 0) continue;
    const fn = node.callFrame?.functionName || "(anonymous)";
    const url = (node.callFrame?.url || "").replace(/^file:\/\//, "");
    const line = node.callFrame?.lineNumber ?? -1;
    if (url.includes("node:") || url.includes("node_modules")) continue;
    const key = `${fn}|${url}|${line}`;
    const prev = byKey.get(key);
    const selfMs = us / 1000;
    if (prev) prev.selfMs += selfMs;
    else byKey.set(key, { functionName: fn, url, line, selfMs });
  }
  return [...byKey.values()]
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, topN)
    .map((r) => ({ ...r, selfMs: Math.round(r.selfMs) }));
}

async function withCpuProfile<T>(fn: () => Promise<T>): Promise<{ result: T; hot: CpuHot[]; wallMs: number }> {
  const session = new inspector.Session();
  session.connect();
  await new Promise<void>((resolve, reject) => {
    session.post("Profiler.enable", (err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    session.post("Profiler.start", (err) => (err ? reject(err) : resolve()));
  });
  const t0 = performance.now();
  let result: T;
  try {
    result = await fn();
  } finally {
    /* continue to stop */
  }
  const wallMs = performance.now() - t0;
  const profile = await new Promise<inspector.Profiler.Profile>((resolve, reject) => {
    session.post("Profiler.stop", (err, res) => {
      if (err) reject(err);
      else resolve((res as { profile: inspector.Profiler.Profile }).profile);
    });
  });
  session.disconnect();
  return { result, hot: summarizeCpuProfile(profile), wallMs: Math.round(wallMs) };
}

function eventLoopProbe(intervalMs = 5) {
  const delays: number[] = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    delays.push(Math.max(0, now - last - intervalMs));
    last = now;
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      const sorted = [...delays].sort((a, b) => a - b);
      return {
        samples: sorted.length,
        maxDelayMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
        meanDelayMs: sorted.length
          ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
          : 0,
        p95DelayMs: sorted.length
          ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!)
          : 0,
        sumDelayMs: Math.round(sorted.reduce((a, b) => a + b, 0)),
      };
    },
  };
}

function clearAllCaches() {
  clearCoachContextCache();
  clearPropSimDedicatedStoresForTests();
  clearAthleteIdentityStoreForTests();
  clearAuthoritativePlayerHistoryForTests();
  resetCoachCacheStats();
}

function canonicalGameKey(body: GameOutcomePost): string {
  return [
    String(body.sport || "").toLowerCase(),
    body.homeTeamId ?? "",
    body.awayTeamId ?? "",
    body.homeTeam ?? "",
    body.awayTeam ?? "",
    body.simulations || COACH_GAME_SIMS,
  ].join("|");
}

function materialSimKey(body: GameOutcomePost): string {
  // Material MC inputs only — excludes cover query lines (markets scored post-draw).
  return canonicalGameKey(body);
}

type GameSimHttpEvt = {
  tRel: number;
  wallMs: number;
  cpuMs: number;
  cache: "network" | "shortcircuit-miss-path";
  sport: string;
  homeTeam: string;
  awayTeam: string;
  simulations: number;
  coverQueryCount: number;
  coverQueryIds: string[];
  fingerprint: string;
  materialKey: string;
  canonicalKey: string;
  outcomesLen: number;
};

async function runCoachScan(opts: {
  label: string;
  clearCaches: boolean;
  interceptGameHttp: boolean;
  shortCircuitGameHttp?: boolean;
  profileCpu?: boolean;
  capturePropSim?: boolean;
}): Promise<{
  label: string;
  coachWallMs: number;
  finalLegs: number;
  eventLoop: ReturnType<ReturnType<typeof eventLoopProbe>["stop"]>;
  gameHttp: GameSimHttpEvt[];
  propSimWalls: number[];
  propSimLastMs: number | null;
  cacheStats: ReturnType<typeof getCoachCacheStats>;
  cpuHot: CpuHot[];
  profileWallMs: number | null;
}> {
  if (opts.clearCaches) clearAllCaches();

  const gameHttp: GameSimHttpEvt[] = [];
  const propSimWalls: number[] = [];
  const scanOrigin = performance.now();
  const loop = eventLoopProbe(5);
  const orig = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = String(init?.method ?? "GET").toUpperCase();

    if (
      opts.capturePropSim &&
      String(url).includes("/sports/simulate/props") &&
      method === "POST"
    ) {
      const t0 = performance.now();
      const res = await orig(input, init);
      propSimWalls.push(Math.round(performance.now() - t0));
      return res;
    }

    const isGameOutcome =
      opts.interceptGameHttp &&
      String(url).includes("/sports/simulate") &&
      !String(url).includes("/simulate/props") &&
      method === "POST";

    if (isGameOutcome) {
      const body = JSON.parse(String(init?.body ?? "{}")) as GameOutcomePost;
      const coverQueries = (body.coverQueries ?? []) as GameCoverQuery[];
      const fingerprint = fingerprintCoachGameSim({
        sport: String(body.sport ?? ""),
        homeTeamId: body.homeTeamId,
        awayTeamId: body.awayTeamId,
        homeTeam: body.homeTeam,
        awayTeam: body.awayTeam,
        simulations: Number(body.simulations ?? COACH_GAME_SIMS),
        coverQueries,
      });
      const t0 = performance.now();
      const cpu0 = process.cpuUsage();
      let res: Response;
      if (opts.shortCircuitGameHttp) {
        // Keep shape; skip network. Outcomes empty → scoring may fall back.
        res = new Response(
          JSON.stringify({
            simulations: body.simulations ?? COACH_GAME_SIMS,
            homeWinProbability: 0.5,
            awayWinProbability: 0.5,
            tieProbability: 0,
            homeProjectedScore: 100,
            awayProjectedScore: 100,
            mostLikelyWinner: "home",
            mostLikelyWinnerPct: 50,
            confidenceScore: 50,
            coverHitRates: Object.fromEntries(coverQueries.map((q) => [q.id, 0.5])),
            outcomes: {
              homeScores: Array.from({ length: COACH_GAME_SIMS }, (_, i) => 90 + (i % 40)),
              awayScores: Array.from({ length: COACH_GAME_SIMS }, (_, i) => 88 + (i % 42)),
            },
            shortCircuit: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      } else {
        res = await orig(input, init);
      }
      const cpu1 = process.cpuUsage(cpu0);
      let outcomesLen = 0;
      try {
        const cloned = res.clone();
        const json = (await cloned.json()) as CoachGameSimEntry;
        outcomesLen = json.outcomes?.homeScores?.length ?? 0;
      } catch {
        /* ignore */
      }
      gameHttp.push({
        tRel: Math.round(t0 - scanOrigin),
        wallMs: Math.round(performance.now() - t0),
        cpuMs: Math.round((cpu1.user + cpu1.system) / 1000),
        cache: opts.shortCircuitGameHttp ? "shortcircuit-miss-path" : "network",
        sport: String(body.sport ?? ""),
        homeTeam: String(body.homeTeam ?? ""),
        awayTeam: String(body.awayTeam ?? ""),
        simulations: Number(body.simulations ?? COACH_GAME_SIMS),
        coverQueryCount: coverQueries.length,
        coverQueryIds: coverQueries.map((q) => q.id).slice(0, 40),
        fingerprint,
        materialKey: materialSimKey(body),
        canonicalKey: canonicalGameKey(body),
        outcomesLen,
      });
      return res;
    }

    return orig(input, init);
  }) as typeof fetch;

  const run = async () => {
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), HARD_MS);
    try {
      return await buildCoachParlay({
        requestedLegs: 5,
        askText: "5 leg",
        priorUserTexts: [],
        signal: ac.signal,
      });
    } finally {
      clearTimeout(kill);
    }
  };

  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  let cpuHot: CpuHot[] = [];
  let profileWallMs: number | null = null;
  const t0 = performance.now();
  try {
    if (opts.profileCpu) {
      const prof = await withCpuProfile(run);
      result = prof.result;
      cpuHot = prof.hot;
      profileWallMs = prof.wallMs;
    } else {
      result = await run();
    }
  } finally {
    globalThis.fetch = orig;
  }
  const eventLoop = loop.stop();
  return {
    label: opts.label,
    coachWallMs: Math.round(performance.now() - t0),
    finalLegs: result?.picks?.length ?? 0,
    eventLoop,
    gameHttp,
    propSimWalls,
    propSimLastMs: propSimWalls.length ? propSimWalls[propSimWalls.length - 1]! : null,
    cacheStats: getCoachCacheStats(),
    cpuHot,
    profileWallMs,
  };
}

/** Microbench: Server MC once vs client distributionForQuery amplification. */
function microbenchDistributionAmplification(sim: CoachGameSimEntry, queries: GameCoverQuery[]) {
  const outcomes = sim.outcomes;
  if (!outcomes?.homeScores?.length) {
    return { error: "no outcomes" as const };
  }
  const n = outcomes.homeScores.length;

  // 1) One deriveCoverHitRates for all queries (server-style)
  const tDerive0 = performance.now();
  const cpuD0 = process.cpuUsage();
  const rates = deriveCoverHitRatesFromOutcomes(outcomes, queries, "nfl");
  const deriveCpu = process.cpuUsage(cpuD0);
  const deriveMs = performance.now() - tDerive0;

  // 2) distributionForQuery-equivalent per query (current sanitizeGameSimHit path)
  const distributionForQueryLocal = (query: GameCoverQuery) => {
    const values: number[] = [];
    for (let i = 0; i < n; i++) {
      const h = outcomes.homeScores[i]!;
      const a = outcomes.awayScores[i]!;
      if (query.kind === "total") values.push(h + a);
      else if (query.kind === "teamTotal") values.push(query.teamSide === "away" ? a : h);
      else if (query.kind === "spread") values.push(query.teamSide === "away" ? a - h : h - a);
      else if (query.kind === "ml") {
        values.push(query.teamSide === "away" ? (a > h ? 1 : 0) : h > a ? 1 : 0);
      }
    }
    const sorted = [...values].sort((x, y) => x - y);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
    return { mean, median, stdev: Math.sqrt(variance) };
  };

  const tDist0 = performance.now();
  const cpuDist0 = process.cpuUsage();
  const dists = queries.map((q) => distributionForQueryLocal(q));
  const distCpu = process.cpuUsage(cpuDist0);
  const distMs = performance.now() - tDist0;

  // 3) Cooperative chunked derive (yield every chunk) — equivalence check
  const chunkSize = 500;
  let chunkHits = 0;
  const tChunk0 = performance.now();
  // sync chunking timing only (no await) to measure pure loop cost vs full
  for (const q of queries) {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const h = outcomes.homeScores[i]!;
      const a = outcomes.awayScores[i]!;
      const total = h + a;
      if (q.kind === "ml") {
        if (q.teamSide === "home" ? h > a : a > h) hits += 1;
      } else if (q.kind === "total") {
        if (q.totalSide === "over" ? total > (q.line ?? 0) : total < (q.line ?? 0)) hits += 1;
      } else if (q.kind === "spread") {
        const line = q.line ?? 0;
        if (q.teamSide === "home" ? h + line > a : a + line > h) hits += 1;
      } else if (q.kind === "teamTotal") {
        const score = q.teamSide === "home" ? h : a;
        if (q.totalSide === "over" ? score > (q.line ?? 0) : score < (q.line ?? 0)) hits += 1;
      }
      void chunkSize;
    }
    chunkHits += hits;
  }
  const chunkSyncMs = performance.now() - tChunk0;

  return {
    outcomesN: n,
    queryCount: queries.length,
    deriveAllQueriesMs: Math.round(deriveMs),
    deriveAllQueriesCpuMs: Math.round((deriveCpu.user + deriveCpu.system) / 1000),
    distributionPerQueryTotalMs: Math.round(distMs),
    distributionPerQueryTotalCpuMs: Math.round((distCpu.user + distCpu.system) / 1000),
    distributionPerQueryMeanMs: Math.round((distMs / Math.max(1, queries.length)) * 100) / 100,
    amplificationVsSingleDerive: Math.round((distMs / Math.max(1, deriveMs)) * 10) / 10,
    chunkSyncEquivalenceLoopMs: Math.round(chunkSyncMs),
    ratesSample: Object.fromEntries(Object.entries(rates).slice(0, 5)),
    distSample: dists.slice(0, 2),
    chunkHits,
  };
}

async function microbenchServerMcOnce() {
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const sim = runGameMonteCarlo({
    sport: "nfl",
    home: { ptsFor: 24, ptsAgainst: 21, recentScores: [27, 20, 31, 17, 24] },
    away: { ptsFor: 22, ptsAgainst: 23, recentScores: [14, 28, 21, 24, 17] },
    simulations: COACH_GAME_SIMS,
    coverQueries: [
      { id: "ml:home", kind: "ml", teamSide: "home" },
      { id: "ml:away", kind: "ml", teamSide: "away" },
      { id: "spread:home:-3.5", kind: "spread", teamSide: "home", line: -3.5 },
      { id: "total:over:45.5", kind: "total", totalSide: "over", line: 45.5 },
      { id: "total:under:45.5", kind: "total", totalSide: "under", line: 45.5 },
      { id: "tt:home:over:23.5", kind: "teamTotal", teamSide: "home", totalSide: "over", line: 23.5 },
    ],
    retainOutcomes: true,
  });
  const cpu1 = process.cpuUsage(cpu0);
  return {
    wallMs: Math.round(performance.now() - t0),
    cpuMs: Math.round((cpu1.user + cpu1.system) / 1000),
    simulations: sim?.simulations ?? 0,
    outcomesLen: sim?.outcomes?.homeScores?.length ?? 0,
    coverRateKeys: Object.keys(sim?.coverHitRates ?? {}).length,
  };
}

/** Cooperative yield microbench: chunk 10k loop with setImmediate; measure event-loop max delay + prop-like promise latency. */
async function benchCooperativeYielding(outcomes: { homeScores: number[]; awayScores: number[] }, queries: GameCoverQuery[]) {
  const n = outcomes.homeScores.length;
  const chunks = [250, 500, 1000, 2000, 5000, 10000];
  const rows = [];
  for (const chunk of chunks) {
    const delays: number[] = [];
    let last = performance.now();
    const probe = setInterval(() => {
      const now = performance.now();
      delays.push(Math.max(0, now - last - 5));
      last = now;
    }, 5);
    probe.unref?.();

    // Concurrent "propSim-like" promise that should resolve while work runs
    let propResolvedAt: number | null = null;
    const propStart = performance.now();
    const propPromise = Promise.resolve().then(async () => {
      await new Promise<void>((r) => setImmediate(r));
      propResolvedAt = performance.now() - propStart;
    });

    const t0 = performance.now();
    const cpu0 = process.cpuUsage();
    const rates: Record<string, number> = {};
    for (const q of queries) {
      let hits = 0;
      for (let i = 0; i < n; i++) {
        const h = outcomes.homeScores[i]!;
        const a = outcomes.awayScores[i]!;
        const total = h + a;
        if (q.kind === "ml") {
          if ((q.teamSide === "home" ? h > a : a > h)) hits += 1;
        } else if (q.kind === "total") {
          if (q.totalSide === "over" ? total > (q.line ?? 0) : total < (q.line ?? 0)) hits += 1;
        } else if (q.kind === "spread") {
          const line = q.line ?? 0;
          if (q.teamSide === "home" ? h + line > a : a + line > h) hits += 1;
        } else if (q.kind === "teamTotal") {
          const score = q.teamSide === "home" ? h : a;
          if (q.totalSide === "over" ? score > (q.line ?? 0) : score < (q.line ?? 0)) hits += 1;
        }
        if (chunk < n && (i + 1) % chunk === 0) {
          await new Promise<void>((r) => setImmediate(r));
        }
      }
      rates[q.id] = Math.round((hits / n) * 1000) / 1000;
    }
    await propPromise;
    const cpu1 = process.cpuUsage(cpu0);
    clearInterval(probe);
    const sorted = [...delays].sort((a, b) => a - b);
    rows.push({
      chunk,
      wallMs: Math.round(performance.now() - t0),
      cpuMs: Math.round((cpu1.user + cpu1.system) / 1000),
      maxEventLoopDelayMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
      propPromiseLatencyMs: propResolvedAt != null ? Math.round(propResolvedAt) : null,
      rateKeys: Object.keys(rates).length,
    });
  }
  return rows;
}

/** Worker-thread overhead probe (no production change). */
async function benchWorkerPool(outcomes: { homeScores: number[]; awayScores: number[] }, queries: GameCoverQuery[]) {
  const { Worker } = await import("node:worker_threads");
  const n = outcomes.homeScores.length;
  const workerSrc = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { homeScores, awayScores, queries } = workerData;
    const n = homeScores.length;
    const rates = {};
    for (const q of queries) {
      let hits = 0;
      for (let i = 0; i < n; i++) {
        const h = homeScores[i];
        const a = awayScores[i];
        const total = h + a;
        if (q.kind === 'ml') {
          if ((q.teamSide === 'home' ? h > a : a > h)) hits++;
        } else if (q.kind === 'total') {
          if (q.totalSide === 'over' ? total > (q.line ?? 0) : total < (q.line ?? 0)) hits++;
        } else if (q.kind === 'spread') {
          const line = q.line ?? 0;
          if (q.teamSide === 'home' ? h + line > a : a + line > h) hits++;
        } else if (q.kind === 'teamTotal') {
          const score = q.teamSide === 'home' ? h : a;
          if (q.totalSide === 'over' ? score > (q.line ?? 0) : score < (q.line ?? 0)) hits++;
        }
      }
      rates[q.id] = Math.round((hits / n) * 1000) / 1000;
    }
    parentPort.postMessage(rates);
  `;

  // Baseline main-thread
  const base = eventLoopProbe(5);
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  deriveCoverHitRatesFromOutcomes(outcomes, queries, "nfl");
  const mainCpu = process.cpuUsage(cpu0);
  const mainWall = performance.now() - t0;
  const mainLoop = base.stop();

  // Worker
  const delays: number[] = [];
  let last = performance.now();
  const probe = setInterval(() => {
    const now = performance.now();
    delays.push(Math.max(0, now - last - 5));
    last = now;
  }, 5);
  probe.unref?.();

  let propLatency: number | null = null;
  const propStart = performance.now();
  const propP = Promise.resolve().then(async () => {
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setTimeout(r, 0));
    propLatency = performance.now() - propStart;
  });

  const tW0 = performance.now();
  const cpuW0 = process.cpuUsage();
  const rates = await new Promise<Record<string, number>>((resolve, reject) => {
    const w = new Worker(workerSrc, {
      eval: true,
      workerData: {
        homeScores: outcomes.homeScores,
        awayScores: outcomes.awayScores,
        queries,
      },
    });
    w.on("message", (msg) => resolve(msg as Record<string, number>));
    w.on("error", reject);
    w.on("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exit ${code}`));
    });
  });
  await propP;
  const cpuW1 = process.cpuUsage(cpuW0);
  clearInterval(probe);
  const sorted = [...delays].sort((a, b) => a - b);

  // Serialization size estimate
  const payloadBytes =
    outcomes.homeScores.length * 8 * 2 + JSON.stringify(queries).length;

  return {
    mainThread: {
      wallMs: Math.round(mainWall),
      cpuMs: Math.round((mainCpu.user + mainCpu.system) / 1000),
      maxEventLoopDelayMs: mainLoop.maxDelayMs,
    },
    workerThread: {
      wallMs: Math.round(performance.now() - tW0),
      mainCpuDuringMs: Math.round((cpuW1.user + cpuW1.system) / 1000),
      maxEventLoopDelayMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
      propPromiseLatencyMs: propLatency != null ? Math.round(propLatency) : null,
      rateKeys: Object.keys(rates).length,
      approxPayloadBytes: payloadBytes,
      renderCompatNote:
        "node:worker_threads available in Node API server; Expo Go / RN client cannot use worker_threads — client-side scoring would need InteractionManager chunks or move grading server-side. Render.com Node services support worker_threads.",
    },
  };
}

function analyzeHttpDuplicates(evts: GameSimHttpEvt[]) {
  const byCanonical = new Map<string, GameSimHttpEvt[]>();
  const byMaterial = new Map<string, GameSimHttpEvt[]>();
  const byFingerprint = new Map<string, GameSimHttpEvt[]>();
  for (const e of evts) {
    const a = byCanonical.get(e.canonicalKey) ?? [];
    a.push(e);
    byCanonical.set(e.canonicalKey, a);
    const b = byMaterial.get(e.materialKey) ?? [];
    b.push(e);
    byMaterial.set(e.materialKey, b);
    const c = byFingerprint.get(e.fingerprint) ?? [];
    c.push(e);
    byFingerprint.set(e.fingerprint, c);
  }
  const duplicateCanonical = [...byCanonical.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([k, v]) => ({
      canonicalKey: k,
      httpCalls: v.length,
      fingerprints: [...new Set(v.map((x) => x.fingerprint))],
      coverQueryCounts: v.map((x) => x.coverQueryCount),
      totalSimulationsRequested: v.reduce((s, x) => s + x.simulations, 0),
    }));
  return {
    httpCalls: evts.length,
    uniqueCanonicalGames: byCanonical.size,
    uniqueMaterialKeys: byMaterial.size,
    uniqueFingerprints: byFingerprint.size,
    duplicateCanonicalGames: duplicateCanonical,
    totalSimulationsRequested: evts.reduce((s, e) => s + e.simulations, 0),
    perGame: [...byCanonical.entries()].map(([k, v]) => ({
      game: k,
      httpCalls: v.length,
      simulationsPerCall: v.map((x) => x.simulations),
      totalSimulations: v.reduce((s, x) => s + x.simulations, 0),
      coverQueryCount: v.map((x) => x.coverQueryCount),
      wallSumMs: v.reduce((s, x) => s + x.wallMs, 0),
      cpuSumMs: v.reduce((s, x) => s + x.cpuMs, 0),
      fingerprints: [...new Set(v.map((x) => x.fingerprint))],
    })),
  };
}

async function dualCoachSingleFlightCheck() {
  // Preserve PR #341 semantics: concurrent scans for distinct requestIds may run;
  // same requestId should single-flight. buildCoachParlay used here has no requestId —
  // exercise two parallel Coach builds and report walls + whether both complete.
  clearAllCaches();
  // Warm once
  await runCoachScan({
    label: "dual-prime",
    clearCaches: false,
    interceptGameHttp: true,
    capturePropSim: true,
  });

  const loop = eventLoopProbe(5);
  const t0 = performance.now();
  const [a, b] = await Promise.all([
    runCoachScan({
      label: "dual-A",
      clearCaches: false,
      interceptGameHttp: true,
      capturePropSim: true,
    }),
    runCoachScan({
      label: "dual-B",
      clearCaches: false,
      interceptGameHttp: true,
      capturePropSim: true,
    }),
  ]);
  const eventLoop = loop.stop();
  return {
    parallelWallMs: Math.round(performance.now() - t0),
    A: {
      coachWallMs: a.coachWallMs,
      finalLegs: a.finalLegs,
      propSimLastMs: a.propSimLastMs,
      gameHttpCalls: a.gameHttp.length,
    },
    B: {
      coachWallMs: b.coachWallMs,
      finalLegs: b.finalLegs,
      propSimLastMs: b.propSimLastMs,
      gameHttpCalls: b.gameHttp.length,
    },
    eventLoop,
    note: "PR #341 single-flight is per requestId in coachBoardScanGuard (coach.tsx path). This harness calls buildCoachParlay twice without shared requestId — measures event-loop contention under two concurrent Coach builds, not guard join behavior.",
  };
}

async function main() {
  console.error("Phase 2.4 simGame CPU audit…");

  // Cold scan with HTTP intercept + CPU profile
  console.error("1) Cold full-board Coach (profile)…");
  const cold = await runCoachScan({
    label: "cold",
    clearCaches: true,
    interceptGameHttp: true,
    profileCpu: true,
    capturePropSim: true,
  });
  console.error(
    `  cold wall=${cold.coachWallMs} legs=${cold.finalLegs} gameHttp=${cold.gameHttp.length} propSim=${cold.propSimLastMs} loopMax=${cold.eventLoop.maxDelayMs}`,
  );

  // Warm scan (caches hot) — the ~16s misattribution case
  console.error("2) Warm full-board Coach (profile)…");
  const warm = await runCoachScan({
    label: "warm",
    clearCaches: false,
    interceptGameHttp: true,
    profileCpu: true,
    capturePropSim: true,
  });
  console.error(
    `  warm wall=${warm.coachWallMs} legs=${warm.finalLegs} gameHttp=${warm.gameHttp.length} propSim=${warm.propSimLastMs} loopMax=${warm.eventLoop.maxDelayMs}`,
  );

  // Warm with game HTTP short-circuit (local scoring still runs on outcomes)
  console.error("3) Warm + game HTTP short-circuit (no CPU profile — faster)…");
  const warmSc = await runCoachScan({
    label: "warm-shortcircuit-http",
    clearCaches: false,
    interceptGameHttp: true,
    shortCircuitGameHttp: true,
    profileCpu: false,
    capturePropSim: true,
  });
  console.error(
    `  warmSc wall=${warmSc.coachWallMs} legs=${warmSc.finalLegs} propSim=${warmSc.propSimLastMs} loopMax=${warmSc.eventLoop.maxDelayMs}`,
  );

  // Checkpoint after Coach scans
  const coldDup = analyzeHttpDuplicates(cold.gameHttp);
  const warmDup = analyzeHttpDuplicates(warm.gameHttp);
  writeFileSync(
    "/opt/cursor/artifacts/coach-phase24-simgame-cpu-audit.partial.json",
    JSON.stringify(
      {
        coldWall: cold.coachWallMs,
        warmWall: warm.coachWallMs,
        warmPropSim: warm.propSimLastMs,
        warmLoop: warm.eventLoop,
        coldHttp: coldDup,
        warmHttp: warmDup,
        warmCpuTop: warm.cpuHot.slice(0, 15),
      },
      null,
      2,
    ),
  );

  // Microbench server MC + client amplification using last warm outcomes if any
  console.error("4) Microbench server MC + distribution amplification…");
  const serverMc = await microbenchServerMcOnce();

  // Build a synthetic 10k outcome set matching coach warm path
  const syntheticOutcomes = {
    homeScores: Array.from({ length: COACH_GAME_SIMS }, (_, i) => 20 + (i % 35)),
    awayScores: Array.from({ length: COACH_GAME_SIMS }, (_, i) => 18 + (i % 37)),
  };
  const sampleQueries: GameCoverQuery[] = [];
  // Approximate a busy game's cover set (~30–80 queries)
  for (const side of ["home", "away"] as const) {
    sampleQueries.push({ id: `ml:${side}`, kind: "ml", teamSide: side });
    for (const line of [-14.5, -10.5, -7.5, -3.5, 3.5, 7.5]) {
      sampleQueries.push({
        id: `spread:${side}:${line}`,
        kind: "spread",
        teamSide: side,
        line,
      });
    }
    for (const line of [17.5, 20.5, 23.5, 27.5]) {
      sampleQueries.push({
        id: `tt:${side}:over:${line}`,
        kind: "teamTotal",
        teamSide: side,
        totalSide: "over",
        line,
      });
      sampleQueries.push({
        id: `tt:${side}:under:${line}`,
        kind: "teamTotal",
        teamSide: side,
        totalSide: "under",
        line,
      });
    }
  }
  for (const line of [38.5, 41.5, 44.5, 47.5, 50.5, 53.5]) {
    sampleQueries.push({ id: `total:over:${line}`, kind: "total", totalSide: "over", line });
    sampleQueries.push({ id: `total:under:${line}`, kind: "total", totalSide: "under", line });
  }

  const amp = microbenchDistributionAmplification(
    {
      simulations: COACH_GAME_SIMS,
      homeWinProbability: 0.55,
      awayWinProbability: 0.45,
      homeProjectedScore: 24,
      awayProjectedScore: 21,
      outcomes: syntheticOutcomes,
    } as CoachGameSimEntry,
    sampleQueries,
  );

  // Scale amp to observed warm pick counts if we can infer from CPU profile
  console.error("5) Cooperative yield + worker benches…");
  const yieldBench = await benchCooperativeYielding(syntheticOutcomes, sampleQueries);
  const workerBench = await benchWorkerPool(syntheticOutcomes, sampleQueries);

  console.error("6) Dual concurrent Coach…");
  const dual = await dualCoachSingleFlightCheck();

  // Function % within simGame-related hot set from warm profile
  const warmHot = warm.cpuHot;
  const simRelated = warmHot.filter((h) =>
    /distributionForQuery|coverQueryHits|simGame|periodScoresForDraw|fgExpected|sanitizeGameSim|deriveCover|scoreGame|evaluateGame|gameSimHit|simGame/i.test(
      h.functionName + h.url,
    ),
  );
  const simRelatedSum = simRelated.reduce((s, h) => s + h.selfMs, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.4-simgame-cpu-audit",
    note: "AUDIT ONLY. No production code changes. No merge/deploy/OTA/EAS. NFL7 shortfall out of scope.",
    priorFinding:
      "Phase 2.3: warm ~16s attributed to runPropSims was event-loop starvation from local game-sim scoring CPU.",
    doNotChange: [
      "Phase 2.1–2.3 caches/history/context",
      "10_000 simulation count",
      "qualification / NFL7 filler",
      "live provider lines/odds authority",
    ],
    workload: {
      ask: "5 leg",
      requestedLegs: 5,
      simulationsPerGame: COACH_GAME_SIMS,
    },
    reuseVsRedo: {
      designIntent:
        "Server gameMonteCarlo: one 10k draw set powers ML/spread/total/teamTotal/period covers in one request (coverQueries scored against same draws).",
      clientFetch: "fetchSlateGameSimulationsWithStatus → one HTTP per game per slate batch with ALL eval-line coverQueries.",
      fingerprintIncludesCoverQueries: true,
      fingerprintFields: [
        "sport",
        "homeTeamId",
        "awayTeamId",
        "homeTeam",
        "awayTeam",
        "simulations",
        "sorted coverQueries (id/kind/side/line/period)",
      ],
      materialContextShouldExclude: [
        "cover query lines/markets (post-draw scoring)",
        "American odds (already excluded)",
      ],
      duplicateRisk:
        "Same canonical game with a different cover-query set → different fingerprint → another 10k HTTP/MC even though draws do not depend on lines.",
      warmPathCpu:
        "Even on cache hit (0 game HTTP), scoreGamesAndMaybePartial → gameSimHitForPick → sanitizeGameSimHit → distributionForQuery walks+sorts 10k outcomes PER pick.",
    },
    coldScan: {
      coachWallMs: cold.coachWallMs,
      finalLegs: cold.finalLegs,
      propSimWalls: cold.propSimWalls,
      propSimLastMs: cold.propSimLastMs,
      eventLoop: cold.eventLoop,
      gameHttpSummary: coldDup,
      cacheStats: cold.cacheStats,
      cpuHotTop15: cold.cpuHot.slice(0, 15),
    },
    warmScan: {
      coachWallMs: warm.coachWallMs,
      finalLegs: warm.finalLegs,
      propSimWalls: warm.propSimWalls,
      propSimLastMs: warm.propSimLastMs,
      eventLoop: warm.eventLoop,
      gameHttpSummary: warmDup,
      cacheStats: warm.cacheStats,
      cpuHotTop20: warm.cpuHot.slice(0, 20),
      simRelatedFunctions: simRelated.map((h) => ({
        function: h.functionName,
        selfMs: h.selfMs,
        pctOfSimRelated: simRelatedSum ? Math.round((h.selfMs / simRelatedSum) * 1000) / 10 : 0,
        file: `${h.url.split("/").slice(-2).join("/")}:${h.line}`,
      })),
      simRelatedSelfSumMs: simRelatedSum,
    },
    warmShortCircuitHttp: {
      coachWallMs: warmSc.coachWallMs,
      finalLegs: warmSc.finalLegs,
      propSimLastMs: warmSc.propSimLastMs,
      eventLoop: warmSc.eventLoop,
      cpuHotTop10: warmSc.cpuHot.slice(0, 10),
      note: "HTTP short-circuit still leaves local distributionForQuery/cover scoring on retained outcomes.",
    },
    microbench: {
      serverOneGame10k: serverMc,
      clientAmplification: amp,
      sampleQueryCount: sampleQueries.length,
    },
    optionsBench: {
      cooperativeYielding: yieldBench,
      workerThread: workerBench,
      serverPrecompute: {
        already: "Server returns coverHitRates + optional outcomes for one 10k run per request.",
        gap: "Client re-aggregates outcomes via distributionForQuery per pick for mean/median/stdev even when coverHitRates already present.",
        proposal:
          "Cache per-query distribution stats once per (game fingerprint, query.id), or compute server-side alongside coverHitRates; do not reduce N=10000.",
      },
    },
    dualConcurrentCoach: dual,
    proposedReuse: {
      priority: "reuse, not weaker simulation",
      oneDistributionPerCanonicalGame:
        "Key material context = sport|homeTeamId|awayTeamId|team names|simulations (+ team form inputs server-side). Exclude cover query lines from fingerprint.",
      reuseFor: [
        "moneyline",
        "spread / alt spread",
        "total / alt total",
        "team totals",
        "periods/halves/quarters only where same outcomes + period profile support (existing deriveCoverHitRatesFromOutcomes path)",
      ],
      doNotReuseAcross: [
        "Materially different team form / injury / weather inputs",
        "Different simulation count",
        "Sports requiring different MC engines (e.g. UFC fight vs score model)",
      ],
      preserve: [
        "Live provider lines/odds as authoritative",
        "N=10_000",
        "Seeded fixture equivalence for probs/EV/grade/order/correlation/ticket",
      ],
    },
    correctnessRequirement: {
      fixedSeededFixturesMustMatch: [
        "game probabilities",
        "expected scores/stat distributions",
        "moneyline/spread/total probabilities",
        "qualification",
        "EV/edge",
        "grade/confidence",
        "candidate ordering",
        "correlation/diversity",
        "final ticket",
      ],
      noApproximation: true,
      noLowerSimCount: true,
    },
    benchmarkTable: [
      {
        version: "cold_current",
        Coach_wall: cold.coachWallMs,
        simGame_related_cpu_self: cold.cpuHot
          .filter((h) => /distributionForQuery|coverQueryHits|simGame|periodScores|deriveCover|sanitizeGameSim/i.test(h.functionName))
          .reduce((s, h) => s + h.selfMs, 0),
        max_event_loop_delay: cold.eventLoop.maxDelayMs,
        propSim_wall: cold.propSimLastMs,
        final_legs: cold.finalLegs,
      },
      {
        version: "warm_current",
        Coach_wall: warm.coachWallMs,
        simGame_related_cpu_self: simRelatedSum,
        max_event_loop_delay: warm.eventLoop.maxDelayMs,
        propSim_wall: warm.propSimLastMs,
        final_legs: warm.finalLegs,
      },
      {
        version: "warm_http_shortcircuit",
        Coach_wall: warmSc.coachWallMs,
        simGame_related_cpu_self: warmSc.cpuHot
          .filter((h) => /distributionForQuery|coverQueryHits|simGame|periodScores|deriveCover|sanitizeGameSim/i.test(h.functionName))
          .reduce((s, h) => s + h.selfMs, 0),
        max_event_loop_delay: warmSc.eventLoop.maxDelayMs,
        propSim_wall: warmSc.propSimLastMs,
        final_legs: warmSc.finalLegs,
      },
    ],
    successMetric:
      "propSim should remain ~milliseconds while game simulation/scoring executes — not starved ~16s on the event loop.",
    nfl7: "Keep 6/7 shortfall separate. Do not change qualification or add filler as part of this performance work.",
    noImplementationYet: true,
  };

  const outJson = "/opt/cursor/artifacts/coach-phase24-simgame-cpu-audit.json";
  writeFileSync(outJson, JSON.stringify(report, null, 2));
  writeFileSync(
    "/workspace/artifacts/api-server/scripts/coach-phase24-simgame-cpu-audit.json",
    JSON.stringify(report, null, 2),
  );
  console.error("Wrote", outJson);
  console.error(
    JSON.stringify(
      {
        coldWall: cold.coachWallMs,
        warmWall: warm.coachWallMs,
        warmPropSim: warm.propSimLastMs,
        warmLoopMax: warm.eventLoop.maxDelayMs,
        warmSimRelatedCpu: simRelatedSum,
        coldUniqueGames: coldDup.uniqueCanonicalGames,
        coldHttp: coldDup.httpCalls,
        coldDupGames: coldDup.duplicateCanonicalGames.length,
        amp: amp,
        yieldChunk500: yieldBench.find((r) => r.chunk === 500),
        worker: workerBench.workerThread,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
