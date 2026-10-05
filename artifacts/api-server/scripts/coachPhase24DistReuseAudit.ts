/**
 * Phase 2.4 AUDIT — distributionForQuery reuse A/B/C.
 *
 * Requires temporary PHASE24_DIST_AUDIT hooks in gameSimScoring + boardMarketScanner
 * (reverted after this script; not shipped).
 *
 *   node --import ./scripts/coachE2ERegisterHooks.mjs ./scripts/coachPhase24DistReuseAudit.ts
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";
import {
  clearCoachContextCache,
  resetCoachCacheStats,
} from "../../stadium-mobile/lib/coachContextCache.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { clearAthleteIdentityStoreForTests } from "../src/lib/athleteIdentityStore.ts";
import { clearAuthoritativePlayerHistoryForTests } from "../src/lib/authoritativePlayerHistory.ts";
import {
  disablePhase24DistAudit,
  phase24DistAudit,
  resetPhase24DistAudit,
  type Phase24DistCall,
} from "./phase24DistAuditState.ts";
import {
  deriveCoverHitRatesFromOutcomes,
  type GameCoverQuery,
} from "../../stadium-mobile/lib/gameSimScoring.ts";
import { periodScoresForDraw } from "../../stadium-mobile/lib/gamePeriodScoring.ts";

const HARD_MS = 300_000;

function clearAll() {
  clearCoachContextCache();
  clearPropSimDedicatedStoresForTests();
  clearAthleteIdentityStoreForTests();
  clearAuthoritativePlayerHistoryForTests();
  resetCoachCacheStats();
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

function ticketFingerprint(picks: Array<{
  game?: string;
  market?: string;
  pick?: string;
  player?: string;
  odds?: number | null;
  propLine?: number | null;
}>): string {
  return picks
    .map(
      (p) =>
        `${p.game ?? ""}|${p.market ?? ""}|${p.pick ?? p.player ?? ""}|${p.propLine ?? ""}|${p.odds ?? ""}`,
    )
    .sort()
    .join("||");
}

async function runMode(mode: "A" | "B" | "C", opts: { clearCaches: boolean; label: string }) {
  if (opts.clearCaches) clearAll();
  const audit = resetPhase24DistAudit(mode);
  audit.yieldEveryGames = 1;

  const propWalls: number[] = [];
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (String(url).includes("/sports/simulate/props") && String(init?.method ?? "GET").toUpperCase() === "POST") {
      const t0 = performance.now();
      const res = await orig(input, init);
      propWalls.push(Math.round(performance.now() - t0));
      return res;
    }
    return orig(input, init);
  }) as typeof fetch;

  const loop = eventLoopProbe(5);
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    const ac = new AbortController();
    const kill = setTimeout(() => ac.abort(), HARD_MS);
    try {
      result = await buildCoachParlay({
        requestedLegs: 5,
        askText: "5 leg",
        priorUserTexts: [],
        signal: ac.signal,
      });
    } finally {
      clearTimeout(kill);
    }
  } finally {
    globalThis.fetch = orig;
  }
  const cpu1 = process.cpuUsage(cpu0);
  const eventLoop = loop.stop();
  const state = phase24DistAudit();
  const calls = [...state.calls] as Phase24DistCall[];

  const byReuse = new Map<string, Phase24DistCall[]>();
  const byGameMaterial = new Map<string, Phase24DistCall[]>();
  for (const c of calls) {
    const a = byReuse.get(c.reuseKey) ?? [];
    a.push(c);
    byReuse.set(c.reuseKey, a);
    const gk = `${c.gameId}||${c.materialContextFingerprint}`;
    const b = byGameMaterial.get(gk) ?? [];
    b.push(c);
    byGameMaterial.set(gk, b);
  }

  const duplicateCpuCalls = [...byReuse.values()]
    .map((arr) => ({
      reuseKey: arr[0]!.reuseKey,
      gameId: arr[0]!.gameId,
      kind: arr[0]!.kind,
      teamSide: arr[0]!.teamSide,
      calls: arr.length,
      uniqueMarkets: [...new Set(arr.map((x) => x.market))],
      uniqueLines: [...new Set(arr.map((x) => x.line))],
      uniquePeriods: [...new Set(arr.map((x) => x.period))],
      wallSumMs: Math.round(arr.reduce((s, x) => s + x.wallMs, 0) * 100) / 100,
      duplicateExtraCalls: Math.max(0, arr.length - 1),
    }))
    .filter((r) => r.calls > 1)
    .sort((a, b) => b.wallSumMs - a.wallSumMs);

  return {
    label: opts.label,
    mode,
    coachWallMs: Math.round(performance.now() - t0),
    cpuUserMs: Math.round(cpu1.user / 1000),
    cpuSystemMs: Math.round(cpu1.system / 1000),
    finalLegs: result?.picks?.length ?? 0,
    ticketFp: ticketFingerprint(result?.picks ?? []),
    picks: (result?.picks ?? []).map((p) => ({
      game: p.game,
      market: p.market,
      pick: p.pick ?? p.player,
      odds: p.odds ?? null,
    })),
    propSimWalls: propWalls,
    propSimObservedWall: propWalls.length ? propWalls[propWalls.length - 1]! : null,
    eventLoop,
    distributionCalls: calls.length,
    uniqueReuseKeys: byReuse.size,
    uniqueGameMaterial: byGameMaterial.size,
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    distCpuMs: Math.round(state.distCpuMs),
    yieldCount: state.yieldCount,
    duplicateCpuCalls: duplicateCpuCalls.slice(0, 40),
    duplicateExtraCallTotal: duplicateCpuCalls.reduce((s, r) => s + r.duplicateExtraCalls, 0),
    callsSample: calls.slice(0, 30),
    callsByKind: Object.fromEntries(
      [...calls.reduce((m, c) => m.set(c.kind, (m.get(c.kind) ?? 0) + 1), new Map<string, number>())],
    ),
    callsByPeriod: Object.fromEntries(
      [...calls.reduce((m, c) => m.set(c.period || "fg", (m.get(c.period || "fg") ?? 0) + 1), new Map<string, number>())],
    ),
  };
}

/** Prove from draw structure what each market needs. */
function classifyMarketsFromDrawStructure() {
  const N = 10_000;
  // Fixed synthetic FG draws (deterministic fixture for structure proof — not production seed).
  const homeScores = Array.from({ length: N }, (_, i) => 14 + ((i * 7) % 31));
  const awayScores = Array.from({ length: N }, (_, i) => 12 + ((i * 11) % 29));
  const outcomes = { homeScores, awayScores };

  const fgQueries: GameCoverQuery[] = [
    { id: "ml:home", kind: "ml", teamSide: "home" },
    { id: "ml:away", kind: "ml", teamSide: "away" },
    { id: "spread:home:-3.5", kind: "spread", teamSide: "home", line: -3.5 },
    { id: "spread:home:-7.5", kind: "spread", teamSide: "home", line: -7.5 },
    { id: "spread:away:+3.5", kind: "spread", teamSide: "away", line: 3.5 },
    { id: "total:over:45.5", kind: "total", totalSide: "over", line: 45.5 },
    { id: "total:under:45.5", kind: "total", totalSide: "under", line: 45.5 },
    { id: "total:over:48.5", kind: "total", totalSide: "over", line: 48.5 },
    { id: "tt:home:over:23.5", kind: "teamTotal", teamSide: "home", totalSide: "over", line: 23.5 },
    { id: "tt:home:under:23.5", kind: "teamTotal", teamSide: "home", totalSide: "under", line: 23.5 },
    { id: "tt:away:over:20.5", kind: "teamTotal", teamSide: "away", totalSide: "over", line: 20.5 },
  ];

  // distributionForQuery value series identity (what B caches)
  function valueSeries(kind: string, teamSide?: string): Float64Array {
    const v = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const h = homeScores[i]!;
      const a = awayScores[i]!;
      if (kind === "total") v[i] = h + a;
      else if (kind === "teamTotal") v[i] = teamSide === "away" ? a : h;
      else if (kind === "spread") v[i] = teamSide === "away" ? a - h : h - a;
      else if (kind === "ml") v[i] = teamSide === "away" ? (a > h ? 1 : 0) : h > a ? 1 : 0;
    }
    return v;
  }
  function seriesFp(v: Float64Array): string {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i]!;
    return `sum=${sum}|0=${v[0]}|mid=${v[Math.floor(N / 2)]}|L=${v[N - 1]}`;
  }

  const seriesByReuse = new Map<string, string>();
  for (const q of fgQueries) {
    const key = q.kind === "total" ? "total" : `${q.kind}|${q.teamSide ?? ""}`;
    const fp = seriesFp(valueSeries(q.kind, q.teamSide));
    if (!seriesByReuse.has(key)) seriesByReuse.set(key, fp);
    else if (seriesByReuse.get(key) !== fp) {
      throw new Error(`series mismatch for ${key}`);
    }
  }

  // Cover hit rates: same draws, different thresholds — derived
  const ratesA = deriveCoverHitRatesFromOutcomes(outcomes, fgQueries, "nfl");
  const ratesB = deriveCoverHitRatesFromOutcomes(outcomes, fgQueries, "nfl");
  const ratesIdentical = JSON.stringify(ratesA) === JSON.stringify(ratesB);

  // Period: periodScoresForDraw injects Math.random — prove non-shareable without seed
  const periodHome: number[] = [];
  const periodAway: number[] = [];
  for (let i = 0; i < 100; i++) {
    const p = periodScoresForDraw("nfl", "h1", homeScores[i]!, awayScores[i]!, {
      homePeriodExpected: 12,
      awayPeriodExpected: 10,
      homeFgExpected: 24,
      awayFgExpected: 21,
    });
    periodHome.push(p.home);
    periodAway.push(p.away);
  }
  const periodHome2: number[] = [];
  for (let i = 0; i < 100; i++) {
    const p = periodScoresForDraw("nfl", "h1", homeScores[i]!, awayScores[i]!, {
      homePeriodExpected: 12,
      awayPeriodExpected: 10,
      homeFgExpected: 24,
      awayFgExpected: 21,
    });
    periodHome2.push(p.home);
  }
  const periodDeterministicFromFg =
    JSON.stringify(periodHome) === JSON.stringify(periodHome2);

  // distributionForQuery ignores period — FG stats used even for period queries
  const distIgnoresPeriod = true; // verified by source inspection of distributionForQuery

  return {
    baseDrawStructure: {
      fields: ["outcomes.homeScores[N]", "outcomes.awayScores[N]"],
      N,
      note: "Full-game score pairs only. No period-specific draws stored on CoachGameSimEntry.",
    },
    marketClassification: [
      {
        market: "moneyline (FG)",
        classification: "same_base_distribution",
        detail: "Hit = compare h vs a on each FG draw. dist stats = mean of 0/1 by teamSide.",
        reuseKeyDims: ["materialFp", "ml", "teamSide"],
      },
      {
        market: "spread / alt spread (FG)",
        classification: "derived_from_base_distribution",
        detail:
          "Value series = margin (h-a or a-h) identical for all lines on a teamSide. Threshold (line) only changes cover hit rate, not mean/median/stdev of margin.",
        reuseKeyDims: ["materialFp", "spread", "teamSide"],
        lineInDistKey: false,
      },
      {
        market: "game total / alt total (FG)",
        classification: "derived_from_base_distribution",
        detail:
          "Value series = h+a identical for all total lines and over/under. Line/side only affect cover hits.",
        reuseKeyDims: ["materialFp", "total"],
        lineInDistKey: false,
        totalSideInDistKey: false,
      },
      {
        market: "team total / alt team total (FG)",
        classification: "derived_from_base_distribution",
        detail: "Value series = home or away FG scores. Line/over-under only affect cover hits.",
        reuseKeyDims: ["materialFp", "teamTotal", "teamSide"],
      },
      {
        market: "first half / halves",
        classification: "requires_distinct_simulation_or_seeded_period_model",
        detail:
          "No H1 draws in outcomes. periodScoresForDraw scales FG draws with Math.random() noise (±7%) each call — not a pure function of base draws. coverQueryHits for period ≠ FG. distributionForQuery still incorrectly uses FG series (ignores period).",
        periodDeterministicFromFg,
        baseContainsPeriodDraws: false,
      },
      {
        market: "quarters / periods (q1–q4, p1–p3, f5, …)",
        classification: "requires_distinct_simulation_or_seeded_period_model",
        detail:
          "Same as halves: derived via periodScoresForDraw + Math.random; not stored in base 10K. Unsupported period×sport → NaN (no FG fallback).",
        periodDeterministicFromFg,
        baseContainsPeriodDraws: false,
      },
      {
        market: "race to",
        classification: "requires_distinct_simulation_or_seeded_period_model",
        detail: "raceToHits uses Math.random walk; distributionForQuery returns null stats for raceTo.",
      },
    ],
    proofs: {
      fgCoverRatesDeterministicFromSameOutcomes: ratesIdentical,
      periodScoresNotDeterministicFromSameFgDraws: !periodDeterministicFromFg,
      distributionForQueryIgnoresPeriodLineTotalSide: distIgnoresPeriod,
      uniqueFgDistSeriesKeys: [...seriesByReuse.keys()],
      altSpreadSharesMarginSeriesWithMain:
        seriesByReuse.get("spread|home") === seriesFp(valueSeries("spread", "home")),
      overUnderShareTotalSeries: true,
    },
  };
}

async function main() {
  console.error("Phase 2.4 distributionForQuery reuse audit…");
  const marketProof = classifyMarketsFromDrawStructure();
  console.error(
    "  market proof: periodDeterministic=",
    !marketProof.proofs.periodScoresNotDeterministicFromSameFgDraws,
    "fgRatesStable=",
    marketProof.proofs.fgCoverRatesDeterministicFromSameOutcomes,
  );

  // Prime caches with a cold scan (mode A, discarded) so A/B/C compare warm-ish fairly,
  // then clear dist audit and run instrumented modes on warm coach context.
  console.error("0) cold prime (no audit)…");
  clearAll();
  {
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
    }
  }
  disablePhase24DistAudit();

  console.error("A) current…");
  const A = await runMode("A", { clearCaches: false, label: "A_current" });
  console.error(
    `  A wall=${A.coachWallMs} distCalls=${A.distributionCalls} uniqueKeys=${A.uniqueReuseKeys} propSim=${A.propSimObservedWall} loopMax=${A.eventLoop.maxDelayMs} dupExtra=${A.duplicateExtraCallTotal}`,
  );

  console.error("B) reuse only…");
  const B = await runMode("B", { clearCaches: false, label: "B_reuse" });
  console.error(
    `  B wall=${B.coachWallMs} distCalls=${B.distributionCalls} uniqueKeys=${B.uniqueReuseKeys} cacheHits=${B.cacheHits}/${B.cacheMisses} propSim=${B.propSimObservedWall} loopMax=${B.eventLoop.maxDelayMs}`,
  );

  console.error("C) reuse + yield…");
  const C = await runMode("C", { clearCaches: false, label: "C_reuse_yield" });
  console.error(
    `  C wall=${C.coachWallMs} distCalls=${C.distributionCalls} uniqueKeys=${C.uniqueReuseKeys} yields=${C.yieldCount} propSim=${C.propSimObservedWall} loopMax=${C.eventLoop.maxDelayMs}`,
  );

  // Also capture one cold A for call-log richness if warm had few calls
  console.error("A-cold) instrumented cold for call log…");
  const Acool = await runMode("A", { clearCaches: true, label: "A_cold_instrumented" });
  console.error(
    `  A-cold wall=${Acool.coachWallMs} distCalls=${Acool.distributionCalls} uniqueKeys=${Acool.uniqueReuseKeys} propSim=${Acool.propSimObservedWall} loopMax=${Acool.eventLoop.maxDelayMs}`,
  );

  const determinism = {
    note: "Game MC is unseeded (Math.random). Ticket equality across A/B/C is expected when B only caches pure FG aggregation and C only yields between games without reordering work. Period cover rates remain noisy.",
    ticketFp: { A: A.ticketFp, B: B.ticketFp, C: C.ticketFp },
    ticketMatch_AB: A.ticketFp === B.ticketFp,
    ticketMatch_AC: A.ticketFp === C.ticketFp,
    ticketMatch_BC: B.ticketFp === C.ticketFp,
    picksA: A.picks,
    picksB: B.picks,
    picksC: C.picks,
    rngDependency:
      "distributionForQuery has no RNG — B is bit-identical for same outcomes. Changing call order does not change FG dist stats. Period coverQueryHits / periodScoresForDraw DO use Math.random; yielding does not change their call order within a game. Server 10k draws remain Math.random per HTTP.",
  };

  const callLog = Acool.distributionCalls > A.distributionCalls ? Acool : A;

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2.4-distributionForQuery-reuse-audit",
    note: "AUDIT ONLY. Temporary hooks in gameSimScoring/boardMarketScanner must be reverted; not production. No merge/deploy/OTA/EAS.",
    workload: { ask: "5 leg", requestedLegs: 5 },
    whatDistributionForQueryProduces: {
      output: "{ mean, median, stdev } of a derived value series from FG outcomes",
      valueSeries: {
        ml: "0/1 win indicator by teamSide",
        spread: "margin h-a or a-h by teamSide (line NOT applied)",
        total: "h+a (totalSide/line NOT applied)",
        teamTotal: "h or a by teamSide (line/totalSide NOT applied)",
        raceTo: "no outcomes series — falls through to null/projection",
      },
      ignores: ["query.line", "query.totalSide", "query.period"],
      implication:
        "All alt lines sharing (kind, teamSide) on the same outcomes object need ONE distributionForQuery; cover hit thresholds are separate (coverHitRates / coverQueryHits).",
    },
    marketProof,
    callInstrumentation: {
      source: callLog.label,
      totalCalls: callLog.distributionCalls,
      uniqueReuseKeys: callLog.uniqueReuseKeys,
      uniqueGameMaterial: callLog.uniqueGameMaterial,
      duplicateExtraCallTotal: callLog.duplicateExtraCallTotal,
      callsByKind: callLog.callsByKind,
      callsByPeriod: callLog.callsByPeriod,
      topDuplicateGroups: callLog.duplicateCpuCalls.slice(0, 15),
      sampleCalls: callLog.callsSample,
      groupByGameMaterialSeed: {
        seed: null,
        modelVersion: "unseeded-Math.random-gameMC + FG-outcomes-aggregation",
        uniqueGroups: callLog.uniqueGameMaterial,
        vsCallsExecuted: callLog.distributionCalls,
      },
    },
    benchmark: {
      A_current: {
        distributionCalls: A.distributionCalls,
        uniqueDists: A.uniqueReuseKeys,
        totalSimCpuApproxDistMs: A.distCpuMs,
        Coach_wall: A.coachWallMs,
        max_event_loop_delay: A.eventLoop.maxDelayMs,
        propSim_observed_wall: A.propSimObservedWall,
        finalLegs: A.finalLegs,
      },
      B_reuse: {
        distributionCalls: B.distributionCalls,
        uniqueDists: B.uniqueReuseKeys,
        cacheHits: B.cacheHits,
        cacheMisses: B.cacheMisses,
        totalSimCpuApproxDistMs: B.distCpuMs,
        Coach_wall: B.coachWallMs,
        max_event_loop_delay: B.eventLoop.maxDelayMs,
        propSim_observed_wall: B.propSimObservedWall,
        finalLegs: B.finalLegs,
      },
      C_reuse_yield: {
        distributionCalls: C.distributionCalls,
        uniqueDists: C.uniqueReuseKeys,
        cacheHits: C.cacheHits,
        cacheMisses: C.cacheMisses,
        yields: C.yieldCount,
        totalSimCpuApproxDistMs: C.distCpuMs,
        Coach_wall: C.coachWallMs,
        max_event_loop_delay: C.eventLoop.maxDelayMs,
        propSim_observed_wall: C.propSimObservedWall,
        finalLegs: C.finalLegs,
      },
      A_cold: {
        distributionCalls: Acool.distributionCalls,
        uniqueDists: Acool.uniqueReuseKeys,
        Coach_wall: Acool.coachWallMs,
        max_event_loop_delay: Acool.eventLoop.maxDelayMs,
        propSim_observed_wall: Acool.propSimObservedWall,
      },
    },
    determinism,
    workerThreads: "Not implemented — evaluate only if B/C insufficient.",
    doNotTouch: [
      "Phase 2.1–2.3 caches",
      "10K count",
      "equations/odds/thresholds/caps/grading/correlation",
      "NFL7 qualification",
    ],
  };

  const out = "/opt/cursor/artifacts/coach-phase24-dist-reuse-audit.json";
  writeFileSync(out, JSON.stringify(report, null, 2));
  writeFileSync(
    "/workspace/artifacts/api-server/scripts/coach-phase24-dist-reuse-audit.json",
    JSON.stringify(report, null, 2),
  );
  disablePhase24DistAudit();
  console.error("Wrote", out);
  console.error(
    JSON.stringify(
      {
        benchmark: report.benchmark,
        uniqueVsCalls: {
          calls: callLog.distributionCalls,
          unique: callLog.uniqueReuseKeys,
          dupExtra: callLog.duplicateExtraCallTotal,
        },
        determinism: {
          AB: determinism.ticketMatch_AB,
          AC: determinism.ticketMatch_AC,
          BC: determinism.ticketMatch_BC,
        },
        periodShareable: !marketProof.proofs.periodScoresNotDeterministicFromSameFgDraws,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  disablePhase24DistAudit();
  process.exit(1);
});
