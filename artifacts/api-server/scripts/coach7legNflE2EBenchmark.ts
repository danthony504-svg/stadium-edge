/**
 * Production-equivalent Coach E2E: "7 leg NFL"
 * Cold shared-distribution + immediate warm-cache, via Phase 1 local prop sims
 * and production for odds/context. Report-only — no merge/OTA/deploy/build.
 */
import { buildCoachParlay } from "../../stadium-mobile/lib/coach/buildParlay.ts";

const ASK = "7 leg NFL";
const LEGS = 7;
const BASELINE_S = 74;
const HARD_TIMEOUT_MS = 180_000;

type PhaseTimers = {
  oddsFetchMs: number;
  contextEnrichmentMs: number;
  playerHistoryMs: number;
  gameSimulationMs: number;
  propSimulationMs: number;
  gradingMs: number;
  correlationStagingMs: number;
  otherApiMs: number;
};

type SimMetrics = {
  distributionCacheHits: number;
  distributionCacheMisses: number;
  distributionsGenerated: number;
  thresholdsEvaluatedFromCache: number;
  thresholdsEvaluatedFromFreshDraw: number;
  monteCarloDrawsAvoided: number;
  monteCarloDrawsExecuted: number;
  propSimElapsedMsReported: number;
  providerLinesEvaluated: number;
  calls: number;
};

type RunSnapshot = {
  label: string;
  totalElapsedMs: number;
  phases: PhaseTimers;
  sim: SimMetrics;
  statuses: string[];
  propPoolSize: number;
  timedOut: boolean;
  finalTicketCount: number;
  qualifiedProps: number;
  qualifiedNonProps: number;
  candidatesScanned: number;
  propsDeepSimmed: number;
  propsFound: number;
  totalQualified: number;
  scanComplete: boolean | null;
  note: string;
  picks: Array<{
    pick: string;
    market: string;
    isProp: boolean;
    side?: string | null;
    line?: number | null;
    odds: number;
    simHit: number | null;
    edgePct: number | null;
    grade: string | null;
    recommends: boolean | null;
  }>;
  propHitMap: Record<string, number | null>;
};

function emptySim(): SimMetrics {
  return {
    distributionCacheHits: 0,
    distributionCacheMisses: 0,
    distributionsGenerated: 0,
    thresholdsEvaluatedFromCache: 0,
    thresholdsEvaluatedFromFreshDraw: 0,
    monteCarloDrawsAvoided: 0,
    monteCarloDrawsExecuted: 0,
    propSimElapsedMsReported: 0,
    providerLinesEvaluated: 0,
    calls: 0,
  };
}

function emptyPhases(): PhaseTimers {
  return {
    oddsFetchMs: 0,
    contextEnrichmentMs: 0,
    playerHistoryMs: 0,
    gameSimulationMs: 0,
    propSimulationMs: 0,
    gradingMs: 0,
    correlationStagingMs: 0,
    otherApiMs: 0,
  };
}

function classifyPath(pathname: string): keyof PhaseTimers | "propSim" | "ignore" {
  const p = pathname.toLowerCase();
  if (p.includes("/sports/simulate/props")) return "propSim";
  if (p.includes("/sports/simulate/game") || p.includes("/sports/simulate/game-outcome")) {
    return "gameSimulationMs";
  }
  if (
    p.includes("/sports/odds") ||
    p.includes("/sports/live-odds") ||
    p.includes("/sports/props") ||
    p.includes("/sports/games") ||
    p.includes("/sports/prizepicks")
  ) {
    return "oddsFetchMs";
  }
  if (
    p.includes("/sports/player-history") ||
    p.includes("/sports/athletes") ||
    p.includes("playerhistory") ||
    p.includes("/history")
  ) {
    return "playerHistoryMs";
  }
  if (
    p.includes("/injuries") ||
    p.includes("/weather") ||
    p.includes("/defense") ||
    p.includes("/team-history") ||
    p.includes("/team-period") ||
    p.includes("/mlb/") ||
    p.includes("/statmuse") ||
    p.includes("/coaches") ||
    p.includes("/matchup")
  ) {
    return "contextEnrichmentMs";
  }
  if (p.includes("/grade") || p.includes("/model-calibration")) return "gradingMs";
  return "otherApiMs";
}

function installFetchProbe(phases: PhaseTimers, sim: SimMetrics) {
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* keep raw */
    }
    const bucket = classifyPath(pathname);
    const t0 = performance.now();
    const res = await orig(input, init);
    const dt = performance.now() - t0;

    if (bucket === "propSim") {
      phases.propSimulationMs += dt;
      try {
        const clone = res.clone();
        const json = (await clone.json()) as Record<string, unknown>;
        sim.calls += 1;
        sim.distributionCacheHits += Number(json.distributionCacheHits ?? 0);
        sim.distributionCacheMisses += Number(json.distributionCacheMisses ?? 0);
        sim.distributionsGenerated += Number(json.distributionsGenerated ?? 0);
        sim.thresholdsEvaluatedFromCache += Number(json.thresholdsEvaluatedFromCache ?? 0);
        sim.thresholdsEvaluatedFromFreshDraw += Number(
          json.thresholdsEvaluatedFromFreshDraw ?? 0,
        );
        sim.monteCarloDrawsAvoided += Number(json.monteCarloDrawsAvoided ?? 0);
        sim.monteCarloDrawsExecuted += Number(json.monteCarloDrawsExecuted ?? 0);
        sim.propSimElapsedMsReported += Number(json.propSimElapsedMs ?? 0);
        sim.providerLinesEvaluated += Number(json.providerLinesEvaluated ?? 0);
      } catch {
        /* non-json */
      }
    } else if (bucket !== "ignore") {
      phases[bucket] += dt;
    }
    return res;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = orig;
  };
}

async function runOnce(label: string): Promise<RunSnapshot> {
  const phases = emptyPhases();
  const sim = emptySim();
  const restore = installFetchProbe(phases, sim);
  const statuses: string[] = [];
  const wallT0 = performance.now();
  const cpuT0 = process.hrtime.bigint();
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), HARD_TIMEOUT_MS);

  let result: Awaited<ReturnType<typeof buildCoachParlay>>;
  try {
    result = await buildCoachParlay({
      requestedLegs: LEGS,
      askText: ASK,
      signal: ac.signal,
      onStatus: (s) => statuses.push(s),
    });
  } finally {
    clearTimeout(kill);
    restore();
  }

  const totalElapsedMs = Math.round(performance.now() - wallT0);
  // Approximate grading+staging as non-network remainder after known phases.
  const accounted =
    phases.oddsFetchMs +
    phases.contextEnrichmentMs +
    phases.playerHistoryMs +
    phases.gameSimulationMs +
    phases.propSimulationMs +
    phases.otherApiMs;
  const localCpuMs = Number(process.hrtime.bigint() - cpuT0) / 1e6;
  phases.gradingMs = Math.max(0, Math.round(localCpuMs * 0.15));
  phases.correlationStagingMs = Math.max(
    0,
    Math.round(totalElapsedMs - accounted - phases.gradingMs),
  );

  const picks = result.picks ?? [];
  const qualifiedProps = picks.filter((p) => p.isProp).length;
  const qualifiedNonProps = picks.filter((p) => !p.isProp).length;
  const manifest = result.scan?.manifest;

  const propHitMap: Record<string, number | null> = {};
  for (const p of picks) {
    if (!p.isProp || !p.player || p.propLine == null) continue;
    const k = `${p.player}|${p.propMarketKey ?? p.market}|${p.propLine}|${p.propSide}`;
    propHitMap[k] = p.finalAiScore?.simHit ?? null;
  }

  return {
    label,
    totalElapsedMs,
    phases: {
      oddsFetchMs: Math.round(phases.oddsFetchMs),
      contextEnrichmentMs: Math.round(phases.contextEnrichmentMs),
      playerHistoryMs: Math.round(phases.playerHistoryMs),
      gameSimulationMs: Math.round(phases.gameSimulationMs),
      propSimulationMs: Math.round(phases.propSimulationMs),
      gradingMs: Math.round(phases.gradingMs),
      correlationStagingMs: Math.round(phases.correlationStagingMs),
      otherApiMs: Math.round(phases.otherApiMs),
    },
    sim,
    statuses,
    propPoolSize: result.propPoolSize,
    timedOut: result.timedOut,
    finalTicketCount: picks.length,
    qualifiedProps,
    qualifiedNonProps,
    candidatesScanned:
      manifest?.totalEvaluated ??
      result.scan?.failureDiagnostics?.scoredBeforeStage ??
      picks.length,
    propsDeepSimmed: manifest?.propsSimulated ?? sim.providerLinesEvaluated,
    propsFound: manifest?.propsFound ?? result.propPoolSize,
    totalQualified: manifest?.totalQualified ?? picks.length,
    scanComplete: result.scan?.scanComplete ?? null,
    note: (result.note || "").slice(0, 400),
    picks: picks.map((p) => ({
      pick: p.pick,
      market: p.market,
      isProp: !!p.isProp,
      side: p.propSide ?? null,
      line: p.propLine ?? null,
      odds: p.odds,
      simHit: p.finalAiScore?.simHit ?? null,
      edgePct: p.finalAiScore?.edgePct ?? null,
      grade: p.finalAiScore?.grade ?? null,
      recommends: p.finalAiScore?.recommends ?? null,
    })),
    propHitMap,
  };
}

function compareEquivalence(cold: RunSnapshot, warm: RunSnapshot) {
  const coldKeys = Object.keys(cold.propHitMap).sort();
  const warmKeys = Object.keys(warm.propHitMap).sort();
  const shared = coldKeys.filter((k) => warmKeys.includes(k));
  let maxHitDiff = 0;
  let maxEdgeDiff = 0;
  const hitMismatches: string[] = [];
  for (const k of shared) {
    const a = cold.propHitMap[k];
    const b = warm.propHitMap[k];
    if (a == null && b == null) continue;
    if (a == null || b == null) {
      hitMismatches.push(`${k}: ${a} vs ${b}`);
      continue;
    }
    maxHitDiff = Math.max(maxHitDiff, Math.abs(a - b));
  }
  for (let i = 0; i < Math.min(cold.picks.length, warm.picks.length); i++) {
    const a = cold.picks[i]!;
    const b = warm.picks[i]!;
    if (a.edgePct != null && b.edgePct != null) {
      maxEdgeDiff = Math.max(maxEdgeDiff, Math.abs(a.edgePct - b.edgePct));
    }
  }

  const coldSides = new Set(
    cold.picks.filter((p) => p.isProp).map((p) => `${p.side}`),
  );
  const warmSides = new Set(
    warm.picks.filter((p) => p.isProp).map((p) => `${p.side}`),
  );
  const coldHasOver = [...coldSides].includes("Over");
  const coldHasUnder = [...coldSides].includes("Under");

  return {
    sameProviderLineKeysOnTicket: coldKeys.length === warmKeys.length && shared.length === coldKeys.length,
    overUnderPreservedOnTicket: {
      coldHasOver,
      coldHasUnder,
      warmHasOver: [...warmSides].includes("Over"),
      warmHasUnder: [...warmSides].includes("Under"),
    },
    finalTicketCount: { cold: cold.finalTicketCount, warm: warm.finalTicketCount },
    expected7of7: {
      cold: cold.finalTicketCount === 7,
      warm: warm.finalTicketCount === 7,
    },
    maxAbsHitDiffSharedProps: maxHitDiff,
    maxAbsEdgeDiffAlignedPicks: maxEdgeDiff,
    hitMismatches: hitMismatches.slice(0, 8),
    withinHitTolerance: maxHitDiff <= 1e-6 || (maxHitDiff < 0.02 && hitMismatches.length === 0),
    withinEdgeTolerance: maxEdgeDiff <= 0.5,
    candidatesNotLost:
      warm.totalQualified >= Math.min(cold.totalQualified, cold.finalTicketCount) ||
      warm.finalTicketCount >= cold.finalTicketCount,
    note: "Warm vs cold use live books; exact ticket identity may rotate with variety/correlation. Hit probs for shared prop keys should match when scored from the same cached distribution.",
  };
}

function topBottlenecks(run: RunSnapshot) {
  const entries: Array<[string, number]> = [
    ["provider/odds fetch", run.phases.oddsFetchMs],
    ["context enrichment", run.phases.contextEnrichmentMs],
    ["player history", run.phases.playerHistoryMs],
    ["game simulation", run.phases.gameSimulationMs],
    ["prop simulation", run.phases.propSimulationMs],
    ["grading (approx)", run.phases.gradingMs],
    ["correlation/staging + local remainder", run.phases.correlationStagingMs],
    ["other API", run.phases.otherApiMs],
  ];
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, ms], i) => ({
      rank: i + 1,
      name,
      ms,
      pctOfTotal: Math.round((ms / Math.max(run.totalElapsedMs, 1)) * 1000) / 10,
    }));
}

function summarizeRun(run: RunSnapshot) {
  return {
    label: run.label,
    totalElapsedSec: Math.round((run.totalElapsedMs / 1000) * 10) / 10,
    totalElapsedMs: run.totalElapsedMs,
    vsBaseline74s: {
      deltaSec: Math.round((run.totalElapsedMs / 1000 - BASELINE_S) * 10) / 10,
      pctOfBaseline: Math.round((run.totalElapsedMs / (BASELINE_S * 1000)) * 1000) / 10,
    },
    phasesMs: run.phases,
    distributionCacheHits: run.sim.distributionCacheHits,
    distributionCacheMisses: run.sim.distributionCacheMisses,
    distributionsGenerated: run.sim.distributionsGenerated,
    thresholdsEvaluatedFromCache: run.sim.thresholdsEvaluatedFromCache,
    thresholdsEvaluatedFromFreshDraw: run.sim.thresholdsEvaluatedFromFreshDraw,
    thresholdsEvaluated:
      run.sim.thresholdsEvaluatedFromCache + run.sim.thresholdsEvaluatedFromFreshDraw,
    monteCarloDrawsGenerated: run.sim.monteCarloDrawsExecuted,
    monteCarloDrawsAvoided: run.sim.monteCarloDrawsAvoided,
    propSimElapsedMs: run.phases.propSimulationMs,
    propSimElapsedMsReported: run.sim.propSimElapsedMsReported,
    candidatesScanned: run.candidatesScanned,
    propsDeepSimmed: run.propsDeepSimmed,
    propsFound: run.propsFound,
    qualifiedProps: run.qualifiedProps,
    qualifiedNonProps: run.qualifiedNonProps,
    totalQualified: run.totalQualified,
    finalTicketCount: run.finalTicketCount,
    scanComplete: run.scanComplete,
    timedOut: run.timedOut,
    propPoolSize: run.propPoolSize,
    propSimCalls: run.sim.calls,
    picks: run.picks,
    statuses: run.statuses,
  };
}

// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    starting: true,
    ask: ASK,
    legs: LEGS,
    baselineSeconds: BASELINE_S,
    apiBase: process.env.BENCH_API_BASE || process.env.EXPO_PUBLIC_DOMAIN,
  }),
);

const cold = await runOnce("cold-shared-distribution");
// Immediate warm — same process keeps Phase 1 in-memory simdist cache.
const warm = await runOnce("warm-cache");

const report = {
  benchmark: "coach-e2e-7leg-nfl",
  ask: ASK,
  requestedLegs: LEGS,
  baselineSeconds: BASELINE_S,
  apiRouting: {
    propSims: "phase1-local-simdist-cache",
    oddsContextHistoryGameSims: "production",
  },
  cold: summarizeRun(cold),
  warm: summarizeRun(warm),
  equivalence: compareEquivalence(cold, warm),
  top3RemainingLatencyBottlenecksAfterPhase1: topBottlenecks(warm.totalElapsedMs < cold.totalElapsedMs ? warm : cold),
  top3Cold: topBottlenecks(cold),
  top3Warm: topBottlenecks(warm),
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(report, null, 2));
