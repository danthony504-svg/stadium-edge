/**
 * AUDIT ONLY — find the ~13.2s inside warm runPropSims.
 * A: isolated runPropSims
 * B: /simulate/props handler path (athlete+injuries+runPropSims), no Coach
 * C: full-board Coach scan (same intercept)
 *
 * No production code changes. No optimizations.
 */
import { writeFileSync } from "node:fs";
import inspector from "node:inspector";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import { resolvePropAthleteIdsDetailed } from "../src/lib/resolvePropAthleteIds.ts";
import { fetchEspnInjuries } from "../src/lib/espnInjuries.ts";
import { keyInjuryWeight, type SimPropRequest } from "../src/lib/monteCarloBuild.ts";
import { tierSimCount } from "../src/lib/propSimRunner.ts";
import {
  runPropSimsPhaseAudit,
  lastPropSimPhaseAudit,
  type PropSimPhaseAudit,
} from "./propSimRunnerPhaseAudit.ts";
import type { SimTier } from "../src/lib/simCache.ts";

const HARD_MS = 300_000;

type CapturedPayload = {
  sport: string;
  tier: SimTier;
  props: SimPropRequest[];
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  isHomeByPlayer: Record<string, boolean>;
  weatherImpact: number | null;
  simulations?: number;
};

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

async function runHandlerPath(body: CapturedPayload): Promise<{
  wallMs: number;
  propSimElapsedMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  audit: PropSimPhaseAudit;
  distStats: Record<string, number>;
}> {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  const { props: propsResolved } = await resolvePropAthleteIdsDetailed(
    body.sport,
    body.props.map((p) => ({ ...p, sport: String(p.sport ?? body.sport).toLowerCase() })),
    {
      homeTeamId: body.homeTeamId,
      awayTeamId: body.awayTeamId,
      homeTeam: body.homeTeam,
      awayTeam: body.awayTeam,
    },
  );
  const injuries = await fetchEspnInjuries(body.sport);
  const out = await runPropSimsPhaseAudit(
    propsResolved,
    body.tier,
    {
      sport: body.sport,
      oppPace: null,
      leaguePace: 100,
      oppKeyInjuries: body.awayTeam ? teamInjuryWeight(injuries, body.awayTeam) : 0,
      ownKeyInjuries: body.homeTeam ? teamInjuryWeight(injuries, body.homeTeam) : 0,
      weatherImpact: body.weatherImpact,
    },
    body.isHomeByPlayer,
    body.simulations,
  );
  const cpu1 = process.cpuUsage(cpu0);
  return {
    wallMs: Math.round(performance.now() - t0),
    propSimElapsedMs: out.propSimElapsedMs,
    cpuUserMs: Math.round(cpu1.user / 1000),
    cpuSystemMs: Math.round(cpu1.system / 1000),
    audit: out.phaseAudit,
    distStats: {
      ctxHits: out.distStats.ctxCacheHits,
      ctxMisses: out.distStats.ctxCacheMisses,
      distHits: out.distStats.distributionCacheHits,
      distMisses: out.distStats.distributionCacheMisses,
      generated: out.distStats.distributionsGenerated,
      historyLoads: out.distStats.historyLoads,
    },
  };
}

async function captureWarmPayload(): Promise<CapturedPayload> {
  clearCoachContextCache();
  clearPropSimDedicatedStoresForTests();
  clearAthleteIdentityStoreForTests();
  clearAuthoritativePlayerHistoryForTests();
  resetCoachCacheStats();

  let captured: CapturedPayload | null = null;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (String(url).includes("/sports/simulate/props") && String(init?.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const payload: CapturedPayload = {
        sport: String(body.sport ?? "").toLowerCase(),
        tier: (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier,
        props: (body.props ?? []) as SimPropRequest[],
        homeTeam: String(body.homeTeam ?? ""),
        awayTeam: String(body.awayTeam ?? ""),
        homeTeamId: String(body.homeTeamId ?? "").trim(),
        awayTeamId: String(body.awayTeamId ?? "").trim(),
        isHomeByPlayer: (body.isHomeByPlayer ?? {}) as Record<string, boolean>,
        weatherImpact:
          String(body.sport ?? "").toLowerCase() === "mlb" && body.weatherImpact != null
            ? Number(body.weatherImpact)
            : null,
        simulations: body.simulations != null ? Number(body.simulations) : undefined,
      };
      // Keep last wave (deep board) as representative warm payload
      captured = payload;
      const t0 = performance.now();
      const { props: propsResolved } = await resolvePropAthleteIdsDetailed(
        payload.sport,
        payload.props.map((p) => ({
          ...p,
          sport: String(p.sport ?? payload.sport).toLowerCase(),
        })),
        {
          homeTeamId: payload.homeTeamId,
          awayTeamId: payload.awayTeamId,
          homeTeam: payload.homeTeam,
          awayTeam: payload.awayTeam,
        },
      );
      const injuries = await fetchEspnInjuries(payload.sport);
      const out = await runPropSimsPhaseAudit(
        propsResolved,
        payload.tier,
        {
          sport: payload.sport,
          oppPace: null,
          leaguePace: 100,
          oppKeyInjuries: payload.awayTeam
            ? teamInjuryWeight(injuries, payload.awayTeam)
            : 0,
          ownKeyInjuries: payload.homeTeam
            ? teamInjuryWeight(injuries, payload.homeTeam)
            : 0,
          weatherImpact: payload.weatherImpact,
        },
        payload.isHomeByPlayer,
        payload.simulations,
      );
      void t0;
      return new Response(
        JSON.stringify({
          sport: payload.sport,
          tier: payload.tier,
          simulations: tierSimCount(payload.tier, payload.simulations),
          deepPending: out.deepPending,
          props: out.rows,
          playerHistories: out.playerHistories,
          historyShared: out.historyShared,
          historyCoalesced: out.historyCoalesced,
          propSimElapsedMs: out.propSimElapsedMs,
          ...out.distStats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return orig(input, init);
  }) as typeof fetch;

  // Cold prime
  const ac1 = new AbortController();
  const k1 = setTimeout(() => ac1.abort(), HARD_MS);
  try {
    await buildCoachParlay({
      requestedLegs: 5,
      askText: "5 leg",
      priorUserTexts: [],
      signal: ac1.signal,
    });
  } finally {
    clearTimeout(k1);
  }

  // Warm capture
  captured = null;
  const ac2 = new AbortController();
  const k2 = setTimeout(() => ac2.abort(), HARD_MS);
  try {
    await buildCoachParlay({
      requestedLegs: 5,
      askText: "5 leg",
      priorUserTexts: [],
      signal: ac2.signal,
    });
  } finally {
    clearTimeout(k2);
    globalThis.fetch = orig;
  }

  if (!captured) throw new Error("failed to capture warm prop-sim payload");
  return captured;
}

type CpuProfileHot = { functionName: string; url: string; line: number; selfMs: number; totalMs: number };

function summarizeCpuProfile(profile: inspector.Profiler.Profile, topN = 20): CpuProfileHot[] {
  const nodes = profile.nodes ?? [];
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];
  const selfUs = new Map<number, number>();
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i]!;
    selfUs.set(id, (selfUs.get(id) ?? 0) + (timeDeltas[i] ?? 0));
  }
  const byKey = new Map<string, CpuProfileHot>();
  for (const node of nodes) {
    const us = selfUs.get(node.id) ?? 0;
    if (us <= 0) continue;
    const fn = node.callFrame?.functionName || "(anonymous)";
    const url = node.callFrame?.url || "";
    const line = node.callFrame?.lineNumber ?? -1;
    // Prefer app frames over node internals.
    if (url.includes("node:") || url.includes("node_modules")) continue;
    const key = `${fn}|${url}|${line}`;
    const prev = byKey.get(key);
    const selfMs = us / 1000;
    if (prev) prev.selfMs += selfMs;
    else byKey.set(key, { functionName: fn, url, line, selfMs, totalMs: selfMs });
  }
  return [...byKey.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, topN).map((r) => ({
    ...r,
    selfMs: Math.round(r.selfMs),
    totalMs: Math.round(r.totalMs),
  }));
}

/** Yield until the event loop is quiet (or timeout). Used by C3 to let overlapping Coach sync finish before runPropSims. */
async function drainEventLoopUntilQuiet(timeoutMs: number): Promise<{
  drainWallMs: number;
  drainCpuUserMs: number;
  drainCpuSystemMs: number;
  quietStreak: number;
  turns: number;
  maxTurnWallMs: number;
  maxTurnCpuMs: number;
  cpuProfileHot: CpuProfileHot[];
}> {
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  let quiet = 0;
  let turns = 0;
  let maxTurnWallMs = 0;
  let maxTurnCpuMs = 0;
  let cpuProfileHot: CpuProfileHot[] = [];

  const session = new inspector.Session();
  session.connect();
  await new Promise<void>((resolve, reject) => {
    session.post("Profiler.enable", (err) => (err ? reject(err) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    session.post("Profiler.start", (err) => (err ? reject(err) : resolve()));
  });

  try {
    while (performance.now() - t0 < timeoutMs) {
      const turnStart = performance.now();
      const turnCpu0 = process.cpuUsage();
      await new Promise<void>((r) => setImmediate(r));
      turns += 1;
      const turnWall = performance.now() - turnStart;
      const turnCpu = process.cpuUsage(turnCpu0);
      const turnCpuMs = (turnCpu.user + turnCpu.system) / 1000;
      if (turnWall > maxTurnWallMs) maxTurnWallMs = turnWall;
      if (turnCpuMs > maxTurnCpuMs) maxTurnCpuMs = turnCpuMs;
      if (turnCpuMs < 2 && turnWall < 8) {
        quiet += 1;
        if (quiet >= 25) break;
      } else {
        quiet = 0;
      }
    }
  } finally {
    const profile = await new Promise<inspector.Profiler.Profile>((resolve, reject) => {
      session.post("Profiler.stop", (err, result) => {
        if (err) reject(err);
        else resolve((result as { profile: inspector.Profiler.Profile }).profile);
      });
    });
    cpuProfileHot = summarizeCpuProfile(profile, 25);
    try {
      writeFileSync(
        "/opt/cursor/artifacts/coach-phase23-c3-drain.cpuprofile",
        JSON.stringify(profile),
      );
    } catch {
      /* best-effort */
    }
    session.disconnect();
  }
  const cpu1 = process.cpuUsage(cpu0);
  return {
    drainWallMs: Math.round(performance.now() - t0),
    drainCpuUserMs: Math.round(cpu1.user / 1000),
    drainCpuSystemMs: Math.round(cpu1.system / 1000),
    quietStreak: quiet,
    turns,
    maxTurnWallMs: Math.round(maxTurnWallMs),
    maxTurnCpuMs: Math.round(maxTurnCpuMs),
    cpuProfileHot,
  };
}

async function runC_FullCoach(opts: {
  shortCircuitGameSim: boolean;
  /** C3: drain overlapping Coach CPU before starting runPropSims. */
  drainBeforePropSim?: boolean;
}): Promise<{
  totalWallMs: number;
  propWaves: Array<{
    wallMs: number;
    propSimElapsedMs: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    audit: PropSimPhaseAudit | null;
    distStats: Record<string, number>;
    gameSimOverlap: {
      calls: number;
      sumWallMs: number;
      overlapWithPropSimMs: number;
    };
    drainBefore?: Awaited<ReturnType<typeof drainEventLoopUntilQuiet>>;
  }>;
  eventLoopDuringScan: {
    samples: number;
    maxDelayMs: number;
    meanDelayMs: number;
    p95DelayMs: number;
  };
  eventLoopDuringPropSim: {
    samples: number;
    maxDelayMs: number;
    meanDelayMs: number;
    p95DelayMs: number;
    sumDelayMs: number;
  } | null;
}> {
  const loopDelays: number[] = [];
  let last = performance.now();
  const loopTimer = setInterval(() => {
    const now = performance.now();
    loopDelays.push(Math.max(0, now - last - 10));
    last = now;
  }, 10);
  loopTimer.unref?.();

  const propWaves: Array<{
    wallMs: number;
    propSimElapsedMs: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    audit: PropSimPhaseAudit | null;
    distStats: Record<string, number>;
    gameSimOverlap: { calls: number; sumWallMs: number; overlapWithPropSimMs: number };
    drainBefore?: Awaited<ReturnType<typeof drainEventLoopUntilQuiet>>;
  }> = [];
  const gameSimEvts: Array<{ start: number; end: number; wall: number }> = [];
  const scanOrigin = performance.now();
  const propSimLoopDelays: number[] = [];
  let propSimLoopLast = 0;
  let propSimLoopActive = false;
  let propSimLoopTimer: ReturnType<typeof setInterval> | null = null;

  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (
      opts.shortCircuitGameSim &&
      String(url).includes("/sports/simulate") &&
      !String(url).includes("/simulate/props")
    ) {
      const t0 = performance.now();
      // Tiny sync burn to keep shape; avoid network
      const end = performance.now();
      gameSimEvts.push({ start: t0 - scanOrigin, end: end - scanOrigin, wall: end - t0 });
      return new Response(JSON.stringify({ ok: true, shortCircuit: true, simulations: 10000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (
      !opts.shortCircuitGameSim &&
      String(url).includes("/sports/simulate") &&
      !String(url).includes("/simulate/props")
    ) {
      const t0 = performance.now();
      const res = await orig(input, init);
      const t1 = performance.now();
      gameSimEvts.push({ start: t0 - scanOrigin, end: t1 - scanOrigin, wall: t1 - t0 });
      return res;
    }

    if (String(url).includes("/sports/simulate/props") && String(init?.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const payload: CapturedPayload = {
        sport: String(body.sport ?? "").toLowerCase(),
        tier: (String(body.tier ?? "deep").toLowerCase() === "quick" ? "quick" : "deep") as SimTier,
        props: (body.props ?? []) as SimPropRequest[],
        homeTeam: String(body.homeTeam ?? ""),
        awayTeam: String(body.awayTeam ?? ""),
        homeTeamId: String(body.homeTeamId ?? "").trim(),
        awayTeamId: String(body.awayTeamId ?? "").trim(),
        isHomeByPlayer: (body.isHomeByPlayer ?? {}) as Record<string, boolean>,
        weatherImpact:
          String(body.sport ?? "").toLowerCase() === "mlb" && body.weatherImpact != null
            ? Number(body.weatherImpact)
            : null,
        simulations: body.simulations != null ? Number(body.simulations) : undefined,
      };
      let drainBefore: Awaited<ReturnType<typeof drainEventLoopUntilQuiet>> | undefined;
      if (opts.drainBeforePropSim) {
        // Drain (including the first yield) so overlapping Coach
        // game-scoring/buildScanResult finishes BEFORE runPropSims.
        // If propSim then drops to ~14ms while drain absorbed ~13s CPU,
        // the prior "propSim 13s" was misattributed concurrent Coach CPU.
        drainBefore = await drainEventLoopUntilQuiet(45_000);
      }

      const t0 = performance.now();
      const cpu0 = process.cpuUsage();
      propSimLoopDelays.length = 0;
      propSimLoopLast = performance.now();
      propSimLoopActive = true;
      if (!propSimLoopTimer) {
        propSimLoopTimer = setInterval(() => {
          if (!propSimLoopActive) return;
          const now = performance.now();
          propSimLoopDelays.push(Math.max(0, now - propSimLoopLast - 5));
          propSimLoopLast = now;
        }, 5);
        propSimLoopTimer.unref?.();
      }

      const { props: propsResolved } = await resolvePropAthleteIdsDetailed(
        payload.sport,
        payload.props.map((p) => ({
          ...p,
          sport: String(p.sport ?? payload.sport).toLowerCase(),
        })),
        {
          homeTeamId: payload.homeTeamId,
          awayTeamId: payload.awayTeamId,
          homeTeam: payload.homeTeam,
          awayTeam: payload.awayTeam,
        },
      );
      const injuries = await fetchEspnInjuries(payload.sport);
      const out = await runPropSimsPhaseAudit(
        propsResolved,
        payload.tier,
        {
          sport: payload.sport,
          oppPace: null,
          leaguePace: 100,
          oppKeyInjuries: payload.awayTeam
            ? teamInjuryWeight(injuries, payload.awayTeam)
            : 0,
          ownKeyInjuries: payload.homeTeam
            ? teamInjuryWeight(injuries, payload.homeTeam)
            : 0,
          weatherImpact: payload.weatherImpact,
        },
        payload.isHomeByPlayer,
        payload.simulations,
      );
      propSimLoopActive = false;
      const cpu1 = process.cpuUsage(cpu0);
      const propStart = t0 - scanOrigin;
      const propEnd = performance.now() - scanOrigin;
      let overlap = 0;
      for (const g of gameSimEvts) {
        overlap += Math.max(0, Math.min(propEnd, g.end) - Math.max(propStart, g.start));
      }
      propWaves.push({
        wallMs: Math.round(performance.now() - t0),
        propSimElapsedMs: out.propSimElapsedMs,
        cpuUserMs: Math.round(cpu1.user / 1000),
        cpuSystemMs: Math.round(cpu1.system / 1000),
        audit: out.phaseAudit,
        distStats: {
          ctxHits: out.distStats.ctxCacheHits,
          ctxMisses: out.distStats.ctxCacheMisses,
          distHits: out.distStats.distributionCacheHits,
          distMisses: out.distStats.distributionCacheMisses,
          generated: out.distStats.distributionsGenerated,
          historyLoads: out.distStats.historyLoads,
        },
        gameSimOverlap: {
          calls: gameSimEvts.length,
          sumWallMs: Math.round(gameSimEvts.reduce((a, g) => a + g.wall, 0)),
          overlapWithPropSimMs: Math.round(overlap),
        },
        drainBefore,
      });
      return new Response(
        JSON.stringify({
          sport: payload.sport,
          tier: payload.tier,
          simulations: tierSimCount(payload.tier, payload.simulations),
          deepPending: out.deepPending,
          props: out.rows,
          playerHistories: out.playerHistories,
          historyShared: out.historyShared,
          historyCoalesced: out.historyCoalesced,
          propSimElapsedMs: out.propSimElapsedMs,
          ...out.distStats,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return orig(input, init);
  }) as typeof fetch;

  const t0 = performance.now();
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
    clearInterval(loopTimer);
    if (propSimLoopTimer) clearInterval(propSimLoopTimer);
    propSimLoopActive = false;
  }

  const sorted = [...loopDelays].sort((a, b) => a - b);
  const propSorted = [...propSimLoopDelays].sort((a, b) => a - b);
  return {
    totalWallMs: Math.round(performance.now() - t0),
    propWaves,
    eventLoopDuringScan: {
      samples: sorted.length,
      maxDelayMs: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
      meanDelayMs: sorted.length
        ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
        : 0,
      p95DelayMs: sorted.length
        ? Math.round(
            sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!,
          )
        : 0,
    },
    eventLoopDuringPropSim: propSorted.length
      ? {
          samples: propSorted.length,
          maxDelayMs: Math.round(propSorted[propSorted.length - 1]!),
          meanDelayMs: Math.round(propSorted.reduce((a, b) => a + b, 0) / propSorted.length),
          p95DelayMs: Math.round(
            propSorted[Math.min(propSorted.length - 1, Math.ceil(propSorted.length * 0.95) - 1)]!,
          ),
          sumDelayMs: Math.round(propSorted.reduce((a, b) => a + b, 0)),
        }
      : null,
  };
}

async function main() {
  console.error("Phase audit: capture warm payload via cold+warm coach…");
  const payload = await captureWarmPayload();
  console.error(
    `captured props=${payload.props.length} sport=${payload.sport} tier=${payload.tier}`,
  );

  // A — isolated runPropSims (handler path without coach; caches already warm)
  console.error("A: isolated handler path ×3");
  const A = [];
  for (let i = 0; i < 3; i++) {
    const r = await runHandlerPath(payload);
    A.push(r);
    console.error(
      `  A${i + 1} wall=${r.wallMs} propEl=${r.propSimElapsedMs} cpu=${r.cpuUserMs}+${r.cpuSystemMs} ctx=${r.distStats.ctxHits}/${r.distStats.ctxMisses} dist=${r.distStats.distHits}/${r.distStats.distMisses} awaitGap~${r.audit.awaitGapEstimateMs} unexplained=${r.audit.unexplainedMs}`,
    );
  }

  // B — same as A conceptually (simulate/props path, no coach). Report mean of A as B.
  // Additionally call once more labeled B for clarity.
  console.error("B: /simulate/props path alone (no concurrent Coach)");
  const B = await runHandlerPath(payload);
  console.error(
    `  B wall=${B.wallMs} propEl=${B.propSimElapsedMs} cpu=${B.cpuUserMs}+${B.cpuSystemMs} awaitGap~${B.audit.awaitGapEstimateMs}`,
  );

  // C — full coach on already-warm caches
  console.error("C: full-board Coach scan (warm caches)");
  const C = await runC_FullCoach({ shortCircuitGameSim: false });

  // C2 — same Coach path but game-sim HTTP returns instantly (isolate prop-sim CPU)
  console.error("C2: full Coach with game-sim short-circuit");
  const C2 = await runC_FullCoach({ shortCircuitGameSim: true });

  // C3 — drain overlapping Coach CPU before runPropSims (prove misattribution)
  console.error("C3: drain event-loop until quiet, then runPropSims");
  const C3 = await runC_FullCoach({ shortCircuitGameSim: true, drainBeforePropSim: true });

  const cWave = C.propWaves[C.propWaves.length - 1];
  console.error(
    `  C total=${C.totalWallMs} waves=${C.propWaves.length} lastWall=${cWave?.wallMs} lastPropEl=${cWave?.propSimElapsedMs} cpu=${cWave?.cpuUserMs}+${cWave?.cpuSystemMs} loopMax=${C.eventLoopDuringScan.maxDelayMs} loopP95=${C.eventLoopDuringScan.p95DelayMs} propLoopMax=${C.eventLoopDuringPropSim?.maxDelayMs} gameOverlap=${cWave?.gameSimOverlap?.overlapWithPropSimMs} gameSum=${cWave?.gameSimOverlap?.sumWallMs}`,
  );
  const c2Wave = C2.propWaves[C2.propWaves.length - 1];
  console.error(
    `  C2 total=${C2.totalWallMs} lastPropEl=${c2Wave?.propSimElapsedMs} cpu=${c2Wave?.cpuUserMs}+${c2Wave?.cpuSystemMs} gameOverlap=${c2Wave?.gameSimOverlap?.overlapWithPropSimMs}`,
  );
  const c3Wave = C3.propWaves[C3.propWaves.length - 1];
  console.error(
    `  C3 total=${C3.totalWallMs} drainWall=${c3Wave?.drainBefore?.drainWallMs} drainCpu=${c3Wave?.drainBefore?.drainCpuUserMs}+${c3Wave?.drainBefore?.drainCpuSystemMs} maxTurn=${c3Wave?.drainBefore?.maxTurnWallMs} propEl=${c3Wave?.propSimElapsedMs} cpu=${c3Wave?.cpuUserMs}+${c3Wave?.cpuSystemMs} ctxSync=${c3Wave?.audit?.contextPhaseSyncMs} ctxAwait=${c3Wave?.audit?.contextPhaseAwaitMs}`,
  );
  if (c3Wave?.drainBefore?.cpuProfileHot?.length) {
    console.error(
      `  C3 drain CPU hot:`,
      c3Wave.drainBefore.cpuProfileHot.slice(0, 10).map(
        (h) => `${h.selfMs}ms ${h.functionName} ${h.url.split("/").slice(-2).join("/")}:${h.line}`,
      ),
    );
  }
  if (cWave?.audit) {
    for (const p of cWave.audit.phases) {
      console.error(
        `    phase ${p.phase}: count=${p.count} wall=${p.exclusiveWallMs} cpu=${p.cpuUserMs}+${p.cpuSystemMs} start=${p.start} end=${p.end} ${p.note ?? ""}`,
      );
    }
    console.error(
      `    ctx occupancy: sync=${cWave.audit.contextPhaseSyncMs} await=${cWave.audit.contextPhaseAwaitMs} cpu=${cWave.audit.contextPhaseCpuMs} maxSyncSlice=${cWave.audit.contextPhaseMaxSyncSliceMs} awaitCount=${cWave.audit.contextPhaseAwaitCount} unexplained=${cWave.audit.unexplainedMs}`,
    );
    console.error(
      `    groups top:`,
      cWave.audit.groups.slice(0, 8).map(
        (g) => `${g.player}/${g.stat}=${g.totalMs}ms(sync~${g.syncMs ?? "?"})`,
      ),
    );
  }

  const aEl = Math.round(A.reduce((s, r) => s + r.propSimElapsedMs, 0) / A.length);
  const cEl = cWave?.propSimElapsedMs ?? 0;
  const c2El = c2Wave?.propSimElapsedMs ?? 0;
  const c3El = c3Wave?.propSimElapsedMs ?? 0;
  const cCtxSync = cWave?.audit?.contextPhaseSyncMs ?? null;
  const cCtxAwait = cWave?.audit?.contextPhaseAwaitMs ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.3-propsim-phase-audit",
    note: "AUDIT ONLY. A/B = same warm payload without Coach concurrency. C = full board scan. Wall/cpuUsage inside runPropSims across awaits includes concurrent same-process Coach CPU. contextPhaseSyncMs/AwaitMs use occupancy accounting (sum to phase wall).",
    mlbRunsRbisMapping: {
      trackSeparately: true,
      note: "batter_runs/batter_rbis stat_mapping_failed — correctness/coverage issue, NOT the 13s root cause; do not change as perf fix.",
    },
    payload: {
      sport: payload.sport,
      tier: payload.tier,
      props: payload.props.length,
      homeTeam: payload.homeTeam,
      awayTeam: payload.awayTeam,
    },
    A_isolated: A.map((r) => ({
      wallMs: r.wallMs,
      propSimElapsedMs: r.propSimElapsedMs,
      cpuUserMs: r.cpuUserMs,
      cpuSystemMs: r.cpuSystemMs,
      distStats: r.distStats,
      audit: r.audit,
    })),
    B_simulatePropsAlone: {
      wallMs: B.wallMs,
      propSimElapsedMs: B.propSimElapsedMs,
      cpuUserMs: B.cpuUserMs,
      cpuSystemMs: B.cpuSystemMs,
      distStats: B.distStats,
      audit: B.audit,
    },
    C_fullCoachScan: C,
    C2_fullCoachGameSimShortCircuit: C2,
    C3_drainThenPropSim: C3,
    comparison: {
      A_meanPropEl: aEl,
      A_meanCpu: Math.round(A.reduce((s, r) => s + r.cpuUserMs + r.cpuSystemMs, 0) / A.length),
      B_propEl: B.propSimElapsedMs,
      B_cpu: B.cpuUserMs + B.cpuSystemMs,
      C_lastPropEl: cEl,
      C_lastCpu: cWave ? cWave.cpuUserMs + cWave.cpuSystemMs : null,
      C_contextSyncMs: cCtxSync,
      C_contextAwaitMs: cCtxAwait,
      C_contextCpuMs: cWave?.audit?.contextPhaseCpuMs ?? null,
      C_contextMaxSyncSliceMs: cWave?.audit?.contextPhaseMaxSyncSliceMs ?? null,
      C_unexplainedMs: cWave?.audit?.unexplainedMs ?? null,
      C_gameSimOverlapMs: cWave?.gameSimOverlap?.overlapWithPropSimMs ?? null,
      C_gameSimSumMs: cWave?.gameSimOverlap?.sumWallMs ?? null,
      C_loopP95: C.eventLoopDuringScan.p95DelayMs,
      C_propLoopMax: C.eventLoopDuringPropSim?.maxDelayMs ?? null,
      C_propLoopSum: C.eventLoopDuringPropSim?.sumDelayMs ?? null,
      C2_lastPropEl: c2El,
      C2_lastCpu: c2Wave ? c2Wave.cpuUserMs + c2Wave.cpuSystemMs : null,
      C2_contextSyncMs: c2Wave?.audit?.contextPhaseSyncMs ?? null,
      C2_contextAwaitMs: c2Wave?.audit?.contextPhaseAwaitMs ?? null,
      C3_drainWallMs: c3Wave?.drainBefore?.drainWallMs ?? null,
      C3_drainCpuMs: c3Wave?.drainBefore
        ? c3Wave.drainBefore.drainCpuUserMs + c3Wave.drainBefore.drainCpuSystemMs
        : null,
      C3_propEl: c3El,
      C3_propCpu: c3Wave ? c3Wave.cpuUserMs + c3Wave.cpuSystemMs : null,
      C3_contextSyncMs: c3Wave?.audit?.contextPhaseSyncMs ?? null,
      C3_contextAwaitMs: c3Wave?.audit?.contextPhaseAwaitMs ?? null,
      C3_maxTurnWallMs: c3Wave?.drainBefore?.maxTurnWallMs ?? null,
      C3_cpuProfileHot: c3Wave?.drainBefore?.cpuProfileHot?.slice(0, 15) ?? [],
      interpretation: (() => {
        if (cEl < 100) return "C_NOT_REPRODUCING_13s";
        if (
          aEl < 100 &&
          c3El < 100 &&
          (c3Wave?.drainBefore?.drainCpuUserMs ?? 0) > 5_000
        ) {
          return "C_13s_IS_CONCURRENT_COACH_CPU_MISATTRIBUTED_drain_absorbed_13s_then_propSim_fast";
        }
        if (
          aEl < 100 &&
          (cCtxAwait ?? 0) > 5_000 &&
          (cCtxSync ?? 0) < 500
        ) {
          return "C_13s_IS_AWAIT_GAP_STARVATION_true_propsim_sync_tiny_cpu_during_awaits_is_other_work";
        }
        if (aEl < 100 && c2El > 5_000 && (cCtxSync ?? 0) > 5_000) {
          return "C_13s_IS_TRUE_PROPSIM_SYNC_CPU_in_context_lookup_build";
        }
        if (aEl < 100 && c2El > 5_000) {
          return "C_13s_REMAINS_WITHOUT_GAME_SIM_HTTP_SEE_OCCUPANCY_AND_C3";
        }
        return "SEE_PHASE_BREAKDOWN";
      })(),
    },
    lastPropSimPhaseAudit,
  };

  const out = "/opt/cursor/artifacts/coach-phase23-propsim-phase-audit.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.error("Wrote", out);
  console.error(JSON.stringify(report.comparison, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
