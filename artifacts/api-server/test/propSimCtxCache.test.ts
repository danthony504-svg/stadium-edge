/**
 * Phase 2.1 — propsim-ctx cache correctness + coalescing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEEP_SIMULATIONS } from "../src/lib/monteCarlo.ts";
import {
  buildPropSimulationContext,
  scoreRequestsFromCachedDistribution,
  simulatePropGroupFromContext,
  type GameSimContext,
  type PlayerHistoryShape,
  type SimPropRequest,
} from "../src/lib/monteCarloBuild.ts";
import {
  getCachedPropDistribution,
  propDistributionCacheKey,
  propHistoryFingerprint,
  setCachedPropDistribution,
} from "../src/lib/propDistributionCache.ts";
import {
  PROPSIM_CTX_TTL_MS,
  cachedPropSimCtxFromContext,
  getCachedPropSimCtx,
  mapWithConcurrency,
  propSimCtxCacheKey,
  propSimulationContextFromCached,
  setCachedPropSimCtx,
  withPropSimCtxInflight,
} from "../src/lib/propSimCtxCache.ts";
import {
  clearPropSimDedicatedStoresForTests,
  withInflightCoalesce,
} from "../src/lib/propSimDedicatedStore.ts";
import { withPropSimDistInflight } from "../src/lib/propDistributionCache.ts";

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

const baseParts = {
  sport: "nfl",
  player: "Nico Collins",
  market: "player_reception_yds",
  athleteId: "4241474",
  opponentTeamId: "12",
  isHome: true as const,
  homeTeamId: "34",
  awayTeamId: "12",
  oppPace: null as number | null,
  leaguePace: null as number | null,
  oppKeyInjuries: 1,
  ownKeyInjuries: 0,
  weatherImpact: null as number | null,
};

const game: GameSimContext = {
  sport: "nfl",
  oppPace: null,
  leaguePace: null,
  oppKeyInjuries: 1,
  ownKeyInjuries: 0,
  weatherImpact: null,
};

const req: SimPropRequest = {
  player: "Nico Collins",
  market: "player_reception_yds",
  line: 69.5,
  side: "Over",
  athleteId: "4241474",
  sport: "nfl",
  isHome: true,
  opponentTeamId: "12",
  homeTeamId: "34",
  awayTeamId: "12",
};

test.beforeEach(() => {
  clearPropSimDedicatedStoresForTests();
});

test("propsim-ctx TTL is 30 minutes", () => {
  assert.equal(PROPSIM_CTX_TTL_MS, 30 * 60_000);
});

test("same material context → same fingerprint → ctx hit → dist hit", async () => {
  const history = historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]);
  const ctx = buildPropSimulationContext(req, history, game);
  assert.ok(ctx);
  const fp = propHistoryFingerprint(ctx!);
  const cached = cachedPropSimCtxFromContext(ctx!);
  assert.equal(cached.fingerprint, fp);

  await setCachedPropSimCtx(baseParts, cached);
  const hit = await getCachedPropSimCtx(baseParts);
  assert.ok(hit);
  assert.equal(hit!.fingerprint, fp);

  const distKey = propDistributionCacheKey(baseParts, fp, "deep", DEEP_SIMULATIONS);
  const drawn = simulatePropGroupFromContext(
    [req],
    propSimulationContextFromCached(hit!, req, game),
    history,
    distKey,
    "deep",
    DEEP_SIMULATIONS,
    { seed: 42 },
  );
  assert.ok(drawn.distribution);
  await setCachedPropDistribution(distKey, drawn.distribution!, "deep");

  const distHit = await getCachedPropDistribution(distKey);
  assert.ok(distHit?.samples?.length);

  // Odds/price change only — reuse dist, rescore with new line.
  const req2: SimPropRequest = { ...req, line: 74.5, side: "Under" };
  const rescored = scoreRequestsFromCachedDistribution(
    [req2],
    history,
    propSimulationContextFromCached(hit!, req2, game),
    distHit!,
  );
  assert.equal(rescored.length, 1);
  assert.ok(rescored[0]!.hitProbability != null);
  assert.notEqual(rescored[0]!.hitProbability, drawn.rows[0]!.hitProbability);
});

test("changed history → changed fingerprint → old dist not reused", async () => {
  const histA = historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]);
  const histB = historyShape([40, 35, 42, 38, 41, 39, 44, 36, 43, 37]);
  const ctxA = buildPropSimulationContext(req, histA, game)!;
  const ctxB = buildPropSimulationContext(req, histB, game)!;
  const fpA = propHistoryFingerprint(ctxA);
  const fpB = propHistoryFingerprint(ctxB);
  assert.notEqual(fpA, fpB);

  await setCachedPropSimCtx(baseParts, cachedPropSimCtxFromContext(ctxA));
  const keyA = propDistributionCacheKey(baseParts, fpA, "deep", DEEP_SIMULATIONS);
  const drawnA = simulatePropGroupFromContext(
    [req],
    ctxA,
    histA,
    keyA,
    "deep",
    DEEP_SIMULATIONS,
    { seed: 1 },
  );
  await setCachedPropDistribution(keyA, drawnA.distribution!, "deep");

  // New history material → new ctx fingerprint → different dist key.
  const cachedB = cachedPropSimCtxFromContext(ctxB);
  await setCachedPropSimCtx(baseParts, cachedB);
  const keyB = propDistributionCacheKey(baseParts, cachedB.fingerprint, "deep", DEEP_SIMULATIONS);
  assert.notEqual(keyA, keyB);
  const oldAtNewKey = await getCachedPropDistribution(keyB);
  assert.equal(oldAtNewKey, undefined);
});

test("changed injury/pace invalidates ctx key (material sharedKey)", async () => {
  const ctx = buildPropSimulationContext(
    req,
    historyShape([82, 71, 95, 64, 88, 77, 90, 68, 84, 73]),
    game,
  )!;
  await setCachedPropSimCtx(baseParts, cachedPropSimCtxFromContext(ctx));
  assert.ok(await getCachedPropSimCtx(baseParts));

  const injured = { ...baseParts, oppKeyInjuries: 3 };
  assert.notEqual(propSimCtxCacheKey(baseParts), propSimCtxCacheKey(injured));
  assert.equal(await getCachedPropSimCtx(injured), undefined);

  const paced = { ...baseParts, oppPace: 102.5 };
  assert.notEqual(propSimCtxCacheKey(baseParts), propSimCtxCacheKey(paced));
});

test("sportsbook odds/price excluded from ctx and dist keys", () => {
  const ctxKey = propSimCtxCacheKey(baseParts);
  assert.equal(ctxKey.includes("-110"), false);
  assert.equal(ctxKey.includes("Over"), false);
  assert.equal(ctxKey.includes("69.5"), false);
  const distKey = propDistributionCacheKey(baseParts, "deadbeefdeadbeef", "deep", DEEP_SIMULATIONS);
  assert.equal(distKey.includes("-110"), false);
  assert.equal(distKey.includes("DraftKings"), false);
});

test("in-flight coalesce: one context load for identical simultaneous waiters", async () => {
  let loads = 0;
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      withPropSimCtxInflight(baseParts, async () => {
        loads += 1;
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, loads };
      }),
    ),
  );
  assert.equal(loads, 1);
  assert.equal(results.filter((r) => r.coalesced).length, 2);
  assert.equal(results.filter((r) => !r.coalesced).length, 1);
  assert.deepEqual(
    results.map((r) => r.value.ok),
    [true, true, true],
  );
});

test("in-flight coalesce: one dist generation; reject does not poison", async () => {
  let gens = 0;
  const key = "simdist:test:poison";

  await assert.rejects(async () => {
    await Promise.all([
      withPropSimDistInflight(key, async () => {
        gens += 1;
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("boom");
      }),
      withPropSimDistInflight(key, async () => {
        gens += 1;
        return "never";
      }),
    ]);
  });
  assert.equal(gens, 1);

  // After failure, a new call must be allowed to run.
  const { value, coalesced } = await withPropSimDistInflight(key, async () => {
    gens += 1;
    return "recovered";
  });
  assert.equal(coalesced, false);
  assert.equal(value, "recovered");
  assert.equal(gens, 2);
});

test("mapWithConcurrency respects bound (never unbounded)", async () => {
  let inflight = 0;
  let maxInflight = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  await mapWithConcurrency(items, 4, async (n) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 15));
    inflight -= 1;
    return n * 2;
  });
  assert.ok(maxInflight <= 4);
  assert.ok(maxInflight >= 2);
});

test("generic withInflightCoalesce cleans up on success", async () => {
  const a = withInflightCoalesce("k1", async () => {
    await new Promise((r) => setTimeout(r, 10));
    return 7;
  });
  const b = withInflightCoalesce("k1", async () => 99);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.value, 7);
  assert.equal(rb.value, 7);
  assert.equal(ra.coalesced || rb.coalesced, true);
  const c = await withInflightCoalesce("k1", async () => 8);
  assert.equal(c.coalesced, false);
  assert.equal(c.value, 8);
});
