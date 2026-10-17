import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEEP_SIMULATIONS,
  runMonteCarloSimulation,
  scoreSharedDistribution,
  scoreTargetsFromSamples,
  type PropSimulationContext,
} from "../src/lib/monteCarlo.ts";
import {
  buildPropSimulationContext,
  cachedPropDistributionFromBundle,
  expandSimPropRowsFromBundle,
  scoreRequestsFromCachedDistribution,
  sharedDistributionPartsForProp,
  simulateProp,
  simulatePropGroupFromContext,
  simulatePropGroupShared,
  type GameSimContext,
  type PlayerHistoryShape,
  type SimPropRequest,
} from "../src/lib/monteCarloBuild.ts";
import {
  emptyPropDistributionCacheStats,
  getCachedPropDistribution,
  propDistributionCacheKey,
  propHistoryFingerprint,
  setCachedPropDistribution,
} from "../src/lib/propDistributionCache.ts";
import { propSharedDistributionKey } from "../src/lib/propSharedDistribution.ts";

function baseCtx(
  overrides: Partial<PropSimulationContext> = {},
): PropSimulationContext {
  return {
    sport: "nfl",
    market: "player_reception_yds",
    line: 69.5,
    side: "Over",
    recentValues: [82, 71, 95, 64, 88, 77, 90, 68, 84, 73],
    vsOpponentValues: [70, 85],
    discrete: false,
    ...overrides,
  };
}

function historyShape(values: number[]): PlayerHistoryShape {
  return {
    labels: ["receivingYards"],
    recent: values.map((v, i) => ({
      stats: { receivingYards: String(v) },
      isHome: i % 2 === 0,
      opponentId: "12",
    })),
    vsOpponent: values.slice(0, 2).map((v) => ({
      stats: { receivingYards: String(v) },
    })),
  };
}

test("propDistributionCacheKey excludes line, side, odds, sportsbook", () => {
  const parts = {
    sport: "nfl",
    player: "Nico Collins",
    market: "player_reception_yds",
    athleteId: "4241474",
    opponentTeamId: "12",
    isHome: true as const,
    homeTeamId: "34",
    awayTeamId: "12",
    oppPace: null,
    leaguePace: null,
    oppKeyInjuries: 1,
    ownKeyInjuries: 0,
    weatherImpact: null,
  };
  const fp = "abc123deadbeef00";
  const a = propDistributionCacheKey(parts, fp, "deep", DEEP_SIMULATIONS);
  const b = propDistributionCacheKey(
    { ...parts, market: "player_reception_yds_alternate" },
    fp,
    "deep",
    DEEP_SIMULATIONS,
  );
  assert.equal(a, b, "main and _alternate share a distribution cache key");
  assert.equal(a.includes("69.5"), false);
  assert.equal(a.includes("Over"), false);
  assert.equal(a.includes("Under"), false);
  assert.equal(a.includes("draftkings"), false);
  assert.equal(a.includes("-110"), false);
  assert.ok(a.startsWith("simdist:deep:10000:"));
});

test("history fingerprint changes when recent form changes", () => {
  const a = propHistoryFingerprint(
    baseCtx({ recentValues: [82, 71, 95, 64, 88] }),
  );
  const b = propHistoryFingerprint(
    baseCtx({ recentValues: [40, 35, 42, 38, 41] }),
  );
  assert.notEqual(a, b);
});

test("injury / weather / pace context re-keys the shared distribution", () => {
  const base = {
    sport: "nfl",
    player: "Nico Collins",
    market: "player_reception_yds",
    athleteId: "1",
    opponentTeamId: "12",
    isHome: true as const,
    homeTeamId: "34",
    awayTeamId: "12",
  };
  const a = propSharedDistributionKey({ ...base, oppKeyInjuries: 0 });
  const b = propSharedDistributionKey({ ...base, oppKeyInjuries: 3 });
  const c = propSharedDistributionKey({ ...base, weatherImpact: 0.4 });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("defenseIndex boost ≠ suppress: separate cache keys and different means/hits", () => {
  // Sparse H2H so defenseIndex drives Opponent Matchup Shift (n < 3).
  const history = historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]);
  const req: SimPropRequest = {
    player: "Nico Collins",
    market: "player_reception_yds",
    line: 69.5,
    side: "Over",
    athleteId: "1",
    sport: "nfl",
    isHome: true,
    opponentTeamId: "12",
    homeTeamId: "34",
    awayTeamId: "12",
  };
  const boostGame: GameSimContext = {
    sport: "nfl",
    defenseIndex: 1.18,
  };
  const suppressGame: GameSimContext = {
    sport: "nfl",
    defenseIndex: 0.84,
  };
  const boostCtx = buildPropSimulationContext(req, history, boostGame)!;
  const suppressCtx = buildPropSimulationContext(req, history, suppressGame)!;
  assert.ok(boostCtx && suppressCtx);
  assert.notEqual(boostCtx.defenseIndex, suppressCtx.defenseIndex);
  assert.notEqual(boostCtx.matchupFamilyMult, suppressCtx.matchupFamilyMult);

  const boostParts = sharedDistributionPartsForProp(req, boostGame, true);
  const suppressParts = sharedDistributionPartsForProp(req, suppressGame, true);
  assert.notEqual(
    propSharedDistributionKey(boostParts),
    propSharedDistributionKey(suppressParts),
  );

  const boostFp = propHistoryFingerprint(boostCtx);
  const suppressFp = propHistoryFingerprint(suppressCtx);
  assert.notEqual(boostFp, suppressFp);

  const boostKey = propDistributionCacheKey(
    boostParts,
    boostFp,
    "deep",
    DEEP_SIMULATIONS,
  );
  const suppressKey = propDistributionCacheKey(
    suppressParts,
    suppressFp,
    "deep",
    DEEP_SIMULATIONS,
  );
  assert.notEqual(boostKey, suppressKey);

  const seed = 0xdefaced;
  const boostSim = runMonteCarloSimulation(boostCtx, DEEP_SIMULATIONS, { seed });
  const suppressSim = runMonteCarloSimulation(suppressCtx, DEEP_SIMULATIONS, {
    seed,
  });
  assert.ok(boostSim.meanProjection != null && suppressSim.meanProjection != null);
  assert.notEqual(boostSim.meanProjection, suppressSim.meanProjection);
  assert.ok(
    boostSim.meanProjection! > suppressSim.meanProjection!,
    "boosted defenseIndex must raise mean vs suppressed",
  );
  assert.ok(boostSim.hitProbability != null && suppressSim.hitProbability != null);
  assert.notEqual(boostSim.hitProbability, suppressSim.hitProbability);
});

test("identical defense context reuses dist cache (cached=true, draws avoided)", async () => {
  const history = historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]);
  const req: SimPropRequest = {
    player: "Nico Collins",
    market: "player_reception_yds",
    line: 69.5,
    side: "Over",
    athleteId: "1",
    sport: "nfl",
    isHome: true,
    opponentTeamId: "12",
    homeTeamId: "34",
    awayTeamId: "12",
  };
  const game: GameSimContext = { sport: "nfl", defenseIndex: 1.12 };
  const ctx = buildPropSimulationContext(req, history, game)!;
  const parts = sharedDistributionPartsForProp(req, game, true);
  const fp = propHistoryFingerprint(ctx);
  const key = propDistributionCacheKey(parts, fp, "deep", DEEP_SIMULATIONS);

  const first = simulatePropGroupFromContext(
    [req],
    ctx,
    history,
    key,
    "deep",
    DEEP_SIMULATIONS,
    { seed: 77 },
  );
  assert.ok(first.distribution);
  await setCachedPropDistribution(key, first.distribution!, "deep");

  // Same identity → same key → cache hit (no second draw needed to score).
  const againFp = propHistoryFingerprint(
    buildPropSimulationContext(req, history, { sport: "nfl", defenseIndex: 1.12 })!,
  );
  const againParts = sharedDistributionPartsForProp(
    req,
    { sport: "nfl", defenseIndex: 1.12 },
    true,
  );
  const againKey = propDistributionCacheKey(
    againParts,
    againFp,
    "deep",
    DEEP_SIMULATIONS,
  );
  assert.equal(againKey, key);
  const loaded = await getCachedPropDistribution(againKey);
  assert.ok(loaded?.samples?.length);
  assert.equal(loaded!.samples.length, DEEP_SIMULATIONS);

  const rescored = scoreRequestsFromCachedDistribution(
    [{ ...req, line: 74.5, side: "Under" }],
    history,
    ctx,
    loaded!,
  );
  assert.equal(rescored.length, 1);
  assert.ok(rescored[0]!.hitProbability != null);
  // Threshold change only — mean/samples reused from cache.
  assert.equal(rescored[0]!.meanProjection, first.distribution!.meanProjection);
});

test("missing/null defenseIndex must not collide with supplied defenseIndex", () => {
  const base = {
    sport: "nfl",
    player: "Nico Collins",
    market: "player_reception_yds",
    athleteId: "1",
    opponentTeamId: "12",
    isHome: true as const,
    homeTeamId: "34",
    awayTeamId: "12",
  };
  const missing = propSharedDistributionKey({ ...base, defenseIndex: null });
  const omitted = propSharedDistributionKey({ ...base });
  const suppliedNeutral = propSharedDistributionKey({
    ...base,
    defenseIndex: 1.0,
  });
  const suppliedBoost = propSharedDistributionKey({
    ...base,
    defenseIndex: 1.15,
  });
  assert.equal(missing, omitted, "null and omitted serialize the same (empty)");
  assert.notEqual(
    missing,
    suppliedNeutral,
    "explicit 1.0 must not collide with missing/null",
  );
  assert.notEqual(missing, suppliedBoost);

  const history = historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]);
  const req: SimPropRequest = {
    player: "Nico Collins",
    market: "player_reception_yds",
    line: 69.5,
    side: "Over",
    athleteId: "1",
    sport: "nfl",
    isHome: true,
    opponentTeamId: "12",
  };
  const ctxMissing = buildPropSimulationContext(req, history, {
    sport: "nfl",
    defenseIndex: null,
  })!;
  const ctxSupplied = buildPropSimulationContext(req, history, {
    sport: "nfl",
    defenseIndex: 1.0,
  })!;
  assert.notEqual(
    propHistoryFingerprint(ctxMissing),
    propHistoryFingerprint(ctxSupplied),
  );
  assert.notEqual(
    propDistributionCacheKey(
      sharedDistributionPartsForProp(req, { sport: "nfl", defenseIndex: null }, true),
      propHistoryFingerprint(ctxMissing),
      "deep",
      DEEP_SIMULATIONS,
    ),
    propDistributionCacheKey(
      sharedDistributionPartsForProp(req, { sport: "nfl", defenseIndex: 1.0 }, true),
      propHistoryFingerprint(ctxSupplied),
      "deep",
      DEEP_SIMULATIONS,
    ),
  );
});

test("equivalence: cached distribution scoring matches seeded per-line sims", () => {
  const seed = 0x51aded;
  const lines = [69.5, 74.5, 79.5];
  const sides = ["Over", "Under"] as const;
  const ctx = baseCtx();

  const perLine: Array<{
    line: number;
    side: "Over" | "Under";
    hitProbability: number | null;
    confidenceScore: number | null;
    meanProjection: number | null;
  }> = [];
  for (const line of lines) {
    for (const side of sides) {
      const r = runMonteCarloSimulation(
        { ...ctx, line, side },
        DEEP_SIMULATIONS,
        { seed },
      );
      perLine.push({
        line,
        side,
        hitProbability: r.hitProbability,
        confidenceScore: r.confidenceScore,
        meanProjection: r.meanProjection,
      });
    }
  }

  const targets = lines.flatMap((line) => sides.map((side) => ({ line, side })));
  const fresh = scoreSharedDistribution(ctx, targets, DEEP_SIMULATIONS, {
    seed,
    evaluateLines: lines,
  });
  const cached = cachedPropDistributionFromBundle(
    "test-dist",
    "deep",
    ctx,
    fresh,
  );
  assert.ok(cached);
  assert.equal(cached!.samples.length, DEEP_SIMULATIONS);

  const fromCache = scoreTargetsFromSamples(
    cached!.samples,
    {
      simulations: cached!.simulations,
      mostLikelyLine: cached!.mostLikelyLine,
      meanProjection: cached!.meanProjection,
      medianProjection: cached!.medianProjection,
      stdDev: cached!.stdDev,
      sampleGames: cached!.sampleGames,
      percentiles: cached!.percentiles,
    },
    targets,
    ctx,
    lines,
  ).results;

  assert.equal(fromCache.length, perLine.length);
  for (let i = 0; i < perLine.length; i++) {
    const a = perLine[i]!;
    const b = fromCache[i]!;
    assert.equal(b.line, a.line);
    assert.equal(b.side, a.side);
    assert.equal(b.hitProbability, a.hitProbability, `hit ${a.side} ${a.line}`);
    assert.equal(
      b.confidenceScore,
      a.confidenceScore,
      `confidence ${a.side} ${a.line}`,
    );
    assert.equal(b.meanProjection, a.meanProjection);
  }
});

test("scoreRequestsFromCachedDistribution preserves provider lines", async () => {
  const seed = 99;
  const history = historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]);
  const game: GameSimContext = {
    sport: "nfl",
    oppKeyInjuries: 0,
    ownKeyInjuries: 0,
  };
  const requests: SimPropRequest[] = [
    {
      player: "Nico Collins",
      market: "player_reception_yds",
      line: 69.5,
      side: "Over",
      athleteId: "1",
      sport: "nfl",
      isHome: true,
      opponentTeamId: "12",
    },
    {
      player: "Nico Collins",
      market: "player_reception_yds_alternate",
      line: 74.5,
      side: "Under",
      athleteId: "1",
      sport: "nfl",
      isHome: true,
      opponentTeamId: "12",
    },
    {
      player: "Nico Collins",
      market: "player_reception_yds",
      line: 79.5,
      side: "Over",
      athleteId: "1",
      sport: "nfl",
      isHome: true,
      opponentTeamId: "12",
    },
  ];

  const fresh = simulatePropGroupShared(requests, history, game, DEEP_SIMULATIONS, {
    seed,
  });
  const ctx = buildPropSimulationContext(requests[0]!, history, game)!;
  const parts = sharedDistributionPartsForProp(requests[0]!, game, true);
  const fp = propHistoryFingerprint(ctx);
  const key = propDistributionCacheKey(parts, fp, "deep", DEEP_SIMULATIONS);

  const bundle = scoreSharedDistribution(
    ctx,
    requests.map((r) => ({ line: r.line, side: r.side })),
    DEEP_SIMULATIONS,
    { seed, evaluateLines: [69.5, 74.5, 79.5] },
  );
  const dist = cachedPropDistributionFromBundle(key, "deep", ctx, bundle)!;
  await setCachedPropDistribution(key, dist, "deep");
  const loaded = await getCachedPropDistribution(key);
  assert.ok(loaded);
  assert.equal(loaded!.samples.length, DEEP_SIMULATIONS);

  const cachedRows = scoreRequestsFromCachedDistribution(
    requests,
    history,
    ctx,
    loaded!,
    [69.5, 74.5, 79.5],
  );

  assert.equal(cachedRows.length, fresh.length);
  for (let i = 0; i < fresh.length; i++) {
    assert.equal(cachedRows[i]!.line, requests[i]!.line);
    assert.equal(cachedRows[i]!.side, requests[i]!.side);
    assert.equal(cachedRows[i]!.market, requests[i]!.market);
    assert.equal(cachedRows[i]!.hitProbability, fresh[i]!.hitProbability);
    assert.equal(cachedRows[i]!.confidenceScore, fresh[i]!.confidenceScore);
  }

  // Solo per-line with same seed remains equivalent (qualification inputs unchanged).
  for (let i = 0; i < requests.length; i++) {
    const solo = simulateProp(requests[i]!, history, game, DEEP_SIMULATIONS, { seed });
    assert.equal(cachedRows[i]!.hitProbability, solo.hitProbability);
  }
});

test("emptyPropDistributionCacheStats starts at zero", () => {
  const s = emptyPropDistributionCacheStats();
  assert.equal(s.distributionCacheHits, 0);
  assert.equal(s.monteCarloDrawsAvoided, 0);
  assert.equal(s.distributionsGenerated, 0);
});

test("expandSimPropRowsFromBundle keeps Over and Under distinct", () => {
  const ctx = baseCtx();
  const bundle = scoreSharedDistribution(
    ctx,
    [
      { line: 69.5, side: "Over" },
      { line: 69.5, side: "Under" },
    ],
    2_000,
    { seed: 7, evaluateLines: [69.5] },
  );
  const rows = expandSimPropRowsFromBundle(
    [
      {
        player: "X",
        market: "player_reception_yds",
        line: 69.5,
        side: "Over",
        sport: "nfl",
      },
      {
        player: "X",
        market: "player_reception_yds",
        line: 69.5,
        side: "Under",
        sport: "nfl",
      },
    ],
    null,
    bundle,
  );
  assert.equal(rows[0]!.side, "Over");
  assert.equal(rows[1]!.side, "Under");
  assert.ok(rows[0]!.hitProbability != null && rows[1]!.hitProbability != null);
  assert.ok(
    Math.abs(rows[0]!.hitProbability! + rows[1]!.hitProbability! - 1) < 0.05 ||
      rows[0]!.hitProbability! !== rows[1]!.hitProbability!,
  );
});
