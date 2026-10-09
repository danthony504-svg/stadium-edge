import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SIM_V2_FLAGS,
  InMemoryShadowLedger,
  assertShadowCannotInfluenceCoach,
  buildFixtureScenarioTensor,
  buildShadowCompareEntry,
  impliedProbFromAmerican,
  parseSimV2FlagsFromEnv,
  selectProductionSimResult,
  settleMarket,
  type SimV2Market,
  type SimV2Odds,
} from "../src/index.js";

const now = new Date().toISOString();

describe("shadow-mode isolation", () => {
  it("default flags never influence production", () => {
    const choice = selectProductionSimResult({
      flags: DEFAULT_SIM_V2_FLAGS,
      sport: "nfl",
      family: "total",
      v1SimHit: 0.55,
      v2: {
        schemaVersion: "sim.v2.1",
        engineId: "simulator-v2",
        marketId: "m",
        eventId: "e",
        sport: "nfl",
        family: "total",
        status: "ok",
        simHit: 0.99,
        providerOddsAmerican: -110,
        impliedProbRaw: 0.5238,
        edgePct: 46,
        evPct: 80,
        modelId: "future.nfl",
        modelVersion: "1.0.0",
        dataFingerprint: "abc",
        nDraws: 10000,
        seed: "s",
        latencyMs: 1,
        computedAt: now,
      },
    });
    assert.equal(choice.engine, "v1");
    assert.equal(choice.simHit, 0.55);
    assert.equal(choice.influencedProduction, false);
    assert.doesNotThrow(() => assertShadowCannotInfluenceCoach(choice));
  });

  it("shadow ledger records V1 vs V2 and optional actuals without seating", () => {
    const ledger = new InMemoryShadowLedger();
    const tensor = buildFixtureScenarioTensor({
      sport: "nfl",
      eventId: "e1",
      seed: "shadow",
      nDraws: 300,
    });
    const market: SimV2Market = {
      marketId: "m1",
      eventId: "e1",
      sport: "nfl",
      family: "total",
      providerMarketKey: "totals",
      period: "fg",
      side: "over",
      line: 40.5,
      settlement: {
        ruleId: "fg_total_over",
        description: "FG total over",
        settlePath: "team.totalFg",
        comparator: "gt",
        lineApplies: true,
        period: "fg",
      },
      listedAt: now,
      provenance: [{ provider: "fixture", fetchedAt: now }],
    };
    const odds: SimV2Odds = {
      marketId: "m1",
      american: -110,
      book: "test",
      capturedAt: now,
      impliedProbRaw: impliedProbFromAmerican(-110),
      provenance: { provider: "fixture", fetchedAt: now },
    };
    const v2 = settleMarket({ tensor, market, odds, allowFixture: true });
    const entry = buildShadowCompareEntry({
      entryId: "row-1",
      sport: "nfl",
      eventId: "e1",
      marketId: "m1",
      family: "total",
      providerMarketKey: "totals",
      providerOddsAmerican: -110,
      v1: { simHit: 0.61, latencyMs: 12 },
      v2,
      actualResult: null,
    });
    ledger.append(entry);
    assert.equal(ledger.list().length, 1);
    assert.equal(ledger.list()[0].shadowOnly, true);
    assert.equal(ledger.list()[0].v1SimHit, 0.61);
    assert.ok(ledger.list()[0].v2SimHit != null);
    assert.ok(ledger.withActualResult("row-1", 1, now));
    assert.equal(ledger.list()[0].actualResult, 1);

    const prod = selectProductionSimResult({
      flags: { ...DEFAULT_SIM_V2_FLAGS, masterEnabled: true, shadowOnly: true },
      sport: "nfl",
      family: "total",
      v1SimHit: 0.61,
      v2,
    });
    assert.equal(prod.influencedProduction, false);
    assert.equal(prod.simHit, 0.61);
  });

  it("FORCE_V1 rollback clears serve path", () => {
    const flags = parseSimV2FlagsFromEnv({
      SIM_V2_ENABLED: "true",
      SIM_V2_SHADOW_ONLY: "false",
      SIM_V2_SERVE: "true",
      SIM_V2_ACCEPTED_FAMILIES: "nfl:total",
      SIM_V2_FORCE_V1: "true",
    });
    assert.equal(flags.forceV1Rollback, true);
    assert.equal(flags.serveEnabled, false);
    assert.deepEqual(flags.acceptedFamilies, []);
  });
});
