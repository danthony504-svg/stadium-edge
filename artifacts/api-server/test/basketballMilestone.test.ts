import assert from "node:assert/strict";
import test from "node:test";
import { gameValueForMarket } from "../src/lib/propStatValue.ts";
import { buildProjectionMean, createPropSimRng, drawPropStatSamples, scoreSharedDistribution } from "../src/lib/monteCarlo.ts";
import { propDistributionCacheKey } from "../src/lib/propDistributionCache.ts";
import { simulatePropGroupShared } from "../src/lib/monteCarloBuild.ts";

test("real game-log pipeline supplies one 10k draw for milestone Yes and No", () => {
  const history = {
    labels: ["PTS", "REB", "AST", "STL", "BLK"],
    recent: Array.from({length:10},(_,i)=>({stats:{PTS:"20",REB:"10",AST:i%2 ? "10" : "9",STL:"0",BLK:"0"}})),
  };
  for (const market of ["player_double_double", "player_triple_double"]) {
    const requests = (["Over","Under"] as const).map(side=>({player:"Player",market,line:0.5,side,sport:"nba",athleteId:"p"}));
    const bundle = simulatePropGroupShared(requests,history,{sport:"nba",playerHistories:new Map()},10000,{seed:91});
    assert.equal(bundle.length,2);
    assert.ok(bundle.every(r=>r.simulations===10000 && r.sampleGames===10));
    assert.ok(Math.abs(bundle[0]!.hitProbability!+bundle[1]!.hitProbability!-1)<0.002);
  }
});

test("milestones require two/three categories in the SAME game and complete unambiguous logs", () => {
  const stats = { PTS: "25", REB: "12", AST: "9", STL: "0", BLK: "1" };
  assert.equal(gameValueForMarket("player_double_double", stats, new Set()), 1);
  assert.equal(gameValueForMarket("player_triple_double", stats, new Set()), 0);
  assert.equal(gameValueForMarket("player_triple_double", { ...stats, AST: "10" }, new Set()), 1);
  assert.equal(gameValueForMarket("player_triple_double_alternate", { ...stats, AST: "10" }, new Set()), 1);
  for (const market of ["player_double_double", "player_triple_double"]) {
    assert.equal(gameValueForMarket(market, { PTS: "25", REB: "12", AST: "10" }, new Set()), null);
    assert.equal(gameValueForMarket(market, stats, new Set(["STL"])), null);
  }
});

test("milestone Yes/No share exactly 10k bounded Bernoulli draws, without count-stat multipliers", () => {
  for (const market of ["player_double_double", "player_triple_double"]) {
    const ctx = { sport: "nba", market, recentValues: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0] };
    const mean = buildProjectionMean({ ...ctx, line: 0.5, side: "Over" });
    assert.equal(buildProjectionMean({ ...ctx, line: 0.5, side: "Over", combinedPreSimMult: 1.35, oppPace: 130, leaguePace: 100, ownKeyInjuries: 4 }), mean);
    const drawn = drawPropStatSamples(ctx, 10000, createPropSimRng(91))!;
    assert.equal(drawn.samples.length, 10000);
    assert.ok(drawn.samples.every(x => x === 0 || x === 1));
    const frequency = drawn.samples.reduce((a,b) => a+b, 0) / drawn.samples.length;
    assert.ok(Math.abs(frequency - mean!) < 0.02);
    const rows = scoreSharedDistribution(ctx, [{line:0.5,side:"Over"},{line:0.5,side:"Under"}], 10000, {seed:91}).results;
    assert.equal(rows.length, 2);
    assert.ok(Math.abs(rows[0]!.hitProbability! + rows[1]!.hitProbability! - 1) < 0.002);
    assert.equal(drawPropStatSamples({ ...ctx, recentValues: [0, 1, 2] }, 10000), null);
    assert.equal(drawPropStatSamples({ ...ctx, recentValues: [0, 1] }, 10000), null);
    for (const recentValues of [[0,0,0], [1,1,1]]) {
      const p = buildProjectionMean({ ...ctx, recentValues, line:0.5, side:"Over" })!;
      assert.ok(p > 0 && p < 1, "short perfect/zero runs must not imply certainty");
    }
  }
});

test("milestone cache versions reject old count draws and preserve warm non-milestone keys", () => {
  const parts = { sport:"nba", player:"Player", market:"player_double_double" };
  const key = propDistributionCacheKey(parts,"history","deep",10000);
  assert.match(key,/milestone-bernoulli-v1:/);
  assert.equal(key,propDistributionCacheKey({...parts,market:"player_double_double_alternate"},"history","deep",10000));
  assert.notEqual(key,propDistributionCacheKey({...parts,market:"player_triple_double"},"history","deep",10000));
  assert.ok(!propDistributionCacheKey({...parts,market:"player_points"},"history","deep",10000).includes("bernoulli"));
});
