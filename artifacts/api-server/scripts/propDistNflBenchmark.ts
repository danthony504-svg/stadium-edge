/**
 * Phase 1 prop-distribution cache: production-equivalent 7-leg NFL prop-sim benchmark.
 *
 * Compares naive per-line 10k draws vs shared+cached distributions for a slate
 * sized like a Coach "7 leg NFL" deep prop-sim wave. Does not merge/OTA/deploy.
 *
 * Usage:
 *   pnpm exec tsx scripts/propDistNflBenchmark.ts
 *   # or against live API:
 *   BENCH_API=https://stadium-edge.onrender.com/api pnpm exec tsx scripts/propDistNflBenchmark.ts
 */
import {
  DEEP_SIMULATIONS,
  runMonteCarloSimulation,
  scoreSharedDistribution,
  scoreTargetsFromSamples,
  type PropSimulationContext,
} from "../src/lib/monteCarlo.ts";
import {
  cachedPropDistributionFromBundle,
  scoreRequestsFromCachedDistribution,
  sharedDistributionPartsForProp,
  type GameSimContext,
  type SimPropRequest,
} from "../src/lib/monteCarloBuild.ts";
import {
  emptyPropDistributionCacheStats,
  getCachedPropDistribution,
  propDistributionCacheKey,
  propHistoryFingerprint,
  setCachedPropDistribution,
} from "../src/lib/propDistributionCache.ts";

type PlayerFixture = {
  player: string;
  athleteId: string;
  market: string;
  lines: number[];
  recentValues: number[];
  isHome: boolean;
  opponentTeamId: string;
  homeTeamId: string;
  awayTeamId: string;
};

/** Representative NFL receiving / rush / pass ladder volume (~7-leg board wave). */
const FIXTURES: PlayerFixture[] = [
  {
    player: "Nico Collins",
    athleteId: "4241474",
    market: "player_reception_yds",
    lines: [69.5, 74.5, 79.5],
    recentValues: [82, 71, 95, 64, 88, 77, 90, 68, 84, 73],
    isHome: true,
    opponentTeamId: "12",
    homeTeamId: "34",
    awayTeamId: "12",
  },
  {
    player: "CeeDee Lamb",
    athleteId: "4241389",
    market: "player_reception_yds",
    lines: [84.5, 89.5, 94.5],
    recentValues: [110, 92, 78, 105, 88, 97, 81, 115, 90, 86],
    isHome: false,
    opponentTeamId: "17",
    homeTeamId: "17",
    awayTeamId: "6",
  },
  {
    player: "Jahmyr Gibbs",
    athleteId: "4429013",
    market: "player_rush_yds",
    lines: [64.5, 74.5, 84.5],
    recentValues: [88, 72, 95, 61, 104, 79, 70, 91, 83, 76],
    isHome: true,
    opponentTeamId: "8",
    homeTeamId: "8",
    awayTeamId: "11",
  },
  {
    player: "Patrick Mahomes",
    athleteId: "3139477",
    market: "player_pass_yds",
    lines: [249.5, 274.5, 299.5],
    recentValues: [280, 265, 310, 242, 295, 271, 288, 255, 302, 268],
    isHome: true,
    opponentTeamId: "7",
    homeTeamId: "12",
    awayTeamId: "7",
  },
  {
    player: "Amon-Ra St. Brown",
    athleteId: "4374302",
    market: "player_receptions",
    lines: [6.5, 7.5, 8.5],
    recentValues: [8, 7, 9, 6, 10, 7, 8, 5, 9, 7],
    isHome: false,
    opponentTeamId: "22",
    homeTeamId: "22",
    awayTeamId: "8",
  },
  {
    player: "Saquon Barkley",
    athleteId: "3929630",
    market: "player_rush_yds",
    lines: [79.5, 89.5, 99.5],
    recentValues: [120, 95, 88, 110, 102, 76, 130, 91, 105, 98],
    isHome: true,
    opponentTeamId: "4",
    homeTeamId: "21",
    awayTeamId: "4",
  },
  {
    player: "Justin Jefferson",
    athleteId: "4262921",
    market: "player_reception_yds",
    lines: [79.5, 89.5, 99.5],
    recentValues: [125, 88, 102, 95, 110, 78, 130, 91, 105, 99],
    isHome: false,
    opponentTeamId: "16",
    homeTeamId: "16",
    awayTeamId: "16",
  },
];

const SEED = 0x7e67;

function ctxFor(f: PlayerFixture, line: number, side: "Over" | "Under"): PropSimulationContext {
  return {
    sport: "nfl",
    market: f.market,
    line,
    side,
    recentValues: f.recentValues,
    discrete: /receptions|rush_attempts|pass_attempts|completions/i.test(f.market),
    isHome: f.isHome,
    oppKeyInjuries: 1,
    ownKeyInjuries: 0,
  };
}

async function runLocalBenchmark() {
  const coachT0 = performance.now();
  const providerLines: Array<{
    fixture: PlayerFixture;
    line: number;
    side: "Over" | "Under";
  }> = [];
  for (const f of FIXTURES) {
    for (const line of f.lines) {
      providerLines.push({ fixture: f, line, side: "Over" });
      providerLines.push({ fixture: f, line, side: "Under" });
    }
  }

  // --- Baseline: naive per-line 10k (pre Phase-1 sharing) ---
  const naiveT0 = performance.now();
  const naiveHits: number[] = [];
  for (const row of providerLines) {
    const r = runMonteCarloSimulation(
      ctxFor(row.fixture, row.line, row.side),
      DEEP_SIMULATIONS,
      { seed: SEED },
    );
    naiveHits.push(r.hitProbability ?? -1);
  }
  const naiveMs = performance.now() - naiveT0;
  const naiveDraws = providerLines.length * DEEP_SIMULATIONS;

  // --- Shared+cached path (Phase 1) ---
  const stats = emptyPropDistributionCacheStats();
  const sharedT0 = performance.now();
  const sharedHits: number[] = [];

  // Pass 1: cold — generate distributions
  for (const f of FIXTURES) {
    const ctx = ctxFor(f, f.lines[0]!, "Over");
    const parts = sharedDistributionPartsForProp(
      {
        player: f.player,
        market: f.market,
        line: f.lines[0]!,
        side: "Over",
        athleteId: f.athleteId,
        sport: "nfl",
        isHome: f.isHome,
        opponentTeamId: f.opponentTeamId,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
      },
      {
        sport: "nfl",
        oppKeyInjuries: 1,
        ownKeyInjuries: 0,
      } satisfies GameSimContext,
      f.isHome,
    );
    const fp = propHistoryFingerprint(ctx);
    const key = propDistributionCacheKey(parts, fp, "deep", DEEP_SIMULATIONS);
    const targets = f.lines.flatMap((line) =>
      (["Over", "Under"] as const).map((side) => ({ line, side })),
    );
    const cached = await getCachedPropDistribution(key);
    if (cached?.samples?.length) {
      stats.distributionCacheHits += 1;
      const scored = scoreTargetsFromSamples(
        cached.samples,
        {
          simulations: cached.simulations,
          mostLikelyLine: cached.mostLikelyLine,
          meanProjection: cached.meanProjection,
          medianProjection: cached.medianProjection,
          stdDev: cached.stdDev,
          sampleGames: cached.sampleGames,
          percentiles: cached.percentiles,
        },
        targets,
        ctx,
        f.lines,
      );
      stats.thresholdsEvaluatedFromCache += scored.results.length;
      stats.monteCarloDrawsAvoided += cached.simulations;
      for (const r of scored.results) sharedHits.push(r.hitProbability ?? -1);
    } else {
      stats.distributionCacheMisses += 1;
      const bundle = scoreSharedDistribution(ctx, targets, DEEP_SIMULATIONS, {
        seed: SEED,
        evaluateLines: f.lines,
      });
      const dist = cachedPropDistributionFromBundle(key, "deep", ctx, bundle)!;
      await setCachedPropDistribution(key, dist, "deep");
      stats.distributionsGenerated += 1;
      stats.monteCarloDrawsExecuted += DEEP_SIMULATIONS;
      stats.thresholdsEvaluatedFromFreshDraw += bundle.results.length;
      for (const r of bundle.results) sharedHits.push(r.hitProbability ?? -1);
    }
  }

  // Pass 2: warm — same provider lines (cache hits); different alt rung order OK
  const warmT0 = performance.now();
  const warmStats = emptyPropDistributionCacheStats();
  const warmHits: number[] = [];
  for (const f of FIXTURES) {
    const ctx = ctxFor(f, f.lines[0]!, "Over");
    const parts = sharedDistributionPartsForProp(
      {
        player: f.player,
        market: f.market,
        line: f.lines[0]!,
        side: "Over",
        athleteId: f.athleteId,
        sport: "nfl",
        isHome: f.isHome,
        opponentTeamId: f.opponentTeamId,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
      },
      { sport: "nfl", oppKeyInjuries: 1, ownKeyInjuries: 0 },
      f.isHome,
    );
    const fp = propHistoryFingerprint(ctx);
    const key = propDistributionCacheKey(parts, fp, "deep", DEEP_SIMULATIONS);
    const targets = f.lines.flatMap((line) =>
      (["Over", "Under"] as const).map((side) => ({ line, side })),
    );
    const cached = await getCachedPropDistribution(key);
    if (!cached?.samples?.length) throw new Error(`expected cache hit for ${f.player}`);
    warmStats.distributionCacheHits += 1;
    const reqs: SimPropRequest[] = targets.map((t) => ({
      player: f.player,
      market: f.market,
      line: t.line,
      side: t.side,
      athleteId: f.athleteId,
      sport: "nfl",
      isHome: f.isHome,
      opponentTeamId: f.opponentTeamId,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
    }));
    const rows = scoreRequestsFromCachedDistribution(reqs, null, ctx, cached, f.lines);
    warmStats.thresholdsEvaluatedFromCache += rows.length;
    warmStats.monteCarloDrawsAvoided += cached.simulations;
    for (const r of rows) warmHits.push(r.hitProbability ?? -1);
  }
  const warmMs = performance.now() - warmT0;
  const sharedMs = performance.now() - sharedT0;
  const coachElapsedMs = performance.now() - coachT0;

  // Equivalence vs naive (same seed)
  let maxAbsDiff = 0;
  for (let i = 0; i < naiveHits.length; i++) {
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(naiveHits[i]! - sharedHits[i]!));
  }
  let warmMaxAbsDiff = 0;
  for (let i = 0; i < sharedHits.length; i++) {
    warmMaxAbsDiff = Math.max(warmMaxAbsDiff, Math.abs(sharedHits[i]! - warmHits[i]!));
  }

  const report = {
    benchmark: "nfl-7leg-prop-dist-cache",
    baselineSeconds: 74,
    providerLinesEvaluated: providerLines.length,
    players: FIXTURES.length,
    equivalence: {
      maxAbsHitDiffVsNaive: maxAbsDiff,
      warmPassExactMatch: warmMaxAbsDiff === 0,
      withinTolerance: maxAbsDiff < 1e-9,
    },
    naive: {
      propSimElapsedMs: Math.round(naiveMs),
      monteCarloDrawsExecuted: naiveDraws,
      distributionsGenerated: providerLines.length,
    },
    coldSharedCached: {
      propSimElapsedMs: Math.round(sharedMs - warmMs),
      ...stats,
    },
    warmSharedCached: {
      propSimElapsedMs: Math.round(warmMs),
      ...warmStats,
    },
    totals: {
      propSimElapsedMs: Math.round(sharedMs),
      coachElapsedMs: Math.round(coachElapsedMs),
      drawsAvoidedVsNaive: naiveDraws - stats.monteCarloDrawsExecuted,
      speedupVsNaive: naiveMs / Math.max(sharedMs - warmMs, 1),
      warmSpeedupVsNaive: naiveMs / Math.max(warmMs, 1),
    },
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function runLiveApiBenchmark(apiBase: string) {
  const coachT0 = performance.now();
  // Production props boards may be empty mid-slate; drive a fixed 7-player ladder
  // that mirrors Coach deep prop-sim volume against the live /simulate/props path.
  const props = FIXTURES.flatMap((f) =>
    f.lines.flatMap((line) =>
      (["Over", "Under"] as const).map((side) => ({
        player: f.player,
        market: f.market,
        line,
        side,
        athleteId: f.athleteId,
        sport: "nfl",
        isHome: f.isHome,
        opponentTeamId: f.opponentTeamId,
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
      })),
    ),
  ).slice(0, 40);

  async function once(label: string) {
    const t0 = performance.now();
    const res = await fetch(`${apiBase}/sports/simulate/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "nfl",
        tier: "deep",
        homeTeam: "Carolina Panthers",
        awayTeam: "Detroit Lions",
        props,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { label, ms: performance.now() - t0, json, ok: res.ok };
  }

  const cold = await once("cold");
  const warm = await once("warm");
  const report = {
    benchmark: "nfl-7leg-live-api",
    apiBase,
    baselineSeconds: 74,
    providerLinesEvaluated: props.length,
    note: "Live production still uses pre-cache shared-within-request draws; Phase 1 branch adds simdist cache metrics.",
    cold: {
      ok: cold.ok,
      wallMs: Math.round(cold.ms),
      distributionCacheHits: cold.json.distributionCacheHits ?? null,
      distributionCacheMisses: cold.json.distributionCacheMisses ?? null,
      distributionsGenerated: cold.json.distributionsGenerated ?? null,
      monteCarloDraws: cold.json.monteCarloDraws ?? null,
      monteCarloDrawsExecuted: cold.json.monteCarloDrawsExecuted ?? null,
      monteCarloDrawsAvoided: cold.json.monteCarloDrawsAvoided ?? null,
      thresholdsEvaluatedFromCache: cold.json.thresholdsEvaluatedFromCache ?? null,
      propSimElapsedMs: cold.json.propSimElapsedMs ?? null,
      coachElapsedMs: cold.json.coachElapsedMs ?? null,
      hitProps: Array.isArray(cold.json.props)
        ? (cold.json.props as Array<{ hitProbability?: number | null }>).filter(
            (p) => p.hitProbability != null,
          ).length
        : 0,
    },
    warm: {
      ok: warm.ok,
      wallMs: Math.round(warm.ms),
      distributionCacheHits: warm.json.distributionCacheHits ?? null,
      distributionCacheMisses: warm.json.distributionCacheMisses ?? null,
      distributionsGenerated: warm.json.distributionsGenerated ?? null,
      monteCarloDraws: warm.json.monteCarloDraws ?? null,
      monteCarloDrawsExecuted: warm.json.monteCarloDrawsExecuted ?? null,
      monteCarloDrawsAvoided: warm.json.monteCarloDrawsAvoided ?? null,
      thresholdsEvaluatedFromCache: warm.json.thresholdsEvaluatedFromCache ?? null,
      propSimElapsedMs: warm.json.propSimElapsedMs ?? null,
      coachElapsedMs: warm.json.coachElapsedMs ?? null,
    },
    totalCoachElapsedMs: Math.round(performance.now() - coachT0),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  return report;
}

const api = process.env.BENCH_API?.trim();
if (api) {
  await runLiveApiBenchmark(api.replace(/\/$/, ""));
} else {
  await runLocalBenchmark();
}
