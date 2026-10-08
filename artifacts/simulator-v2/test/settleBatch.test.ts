import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFixtureScenarioTensor,
  impliedProbFromAmerican,
  settleAltLineBatch,
  settleMarket,
  type SimV2Market,
  type SimV2Odds,
} from "../src/index.js";

const now = new Date().toISOString();
const provenance = [{ provider: "fixture", fetchedAt: now }];

function totalMarket(line: number, id: string): SimV2Market {
  return {
    marketId: id,
    eventId: "e1",
    sport: "nfl",
    family: "total",
    providerMarketKey: "totals",
    period: "fg",
    side: "over",
    line,
    settlement: {
      ruleId: "fg_total_over",
      description: "FG total over",
      settlePath: "team.totalFg",
      comparator: "gt",
      lineApplies: true,
      period: "fg",
    },
    listedAt: now,
    provenance,
  };
}

function oddsFor(marketId: string, american: number): SimV2Odds {
  return {
    marketId,
    american,
    book: "test",
    capturedAt: now,
    impliedProbRaw: impliedProbFromAmerican(american),
    provenance: provenance[0],
  };
}

describe("settle + alt-line batch reuse", () => {
  it("rejects fixture tensors for production settle", () => {
    const tensor = buildFixtureScenarioTensor({
      sport: "nfl",
      eventId: "e1",
      seed: "s1",
      nDraws: 200,
    });
    const result = settleMarket({
      tensor,
      market: totalMarket(40.5, "m1"),
      odds: oddsFor("m1", -110),
      allowFixture: false,
    });
    assert.equal(result.status, "fixture_only");
    assert.equal(result.simHit, null);
    assert.equal(result.providerOddsAmerican, -110);
  });

  it("settles alt lines from one tensor without re-sim", () => {
    const tensor = buildFixtureScenarioTensor({
      sport: "nfl",
      eventId: "e1",
      seed: "batch-seed",
      nDraws: 2000,
    });
    const markets = [totalMarket(38.5, "a"), totalMarket(40.5, "b"), totalMarket(44.5, "c")];
    const batch = settleAltLineBatch({
      tensor,
      markets,
      oddsByMarketId: {
        a: oddsFor("a", -110),
        b: oddsFor("b", -105),
        c: oddsFor("c", 100),
      },
      allowFixture: true,
    });
    assert.equal(batch.reusedSingleTensor, true);
    assert.equal(batch.results.length, 3);
    assert.ok(batch.results.every((r) => r.status === "ok"));
    // Higher line ⇒ lower or equal Over hit rate on same distribution.
    assert.ok(batch.results[0].simHit! >= batch.results[1].simHit!);
    assert.ok(batch.results[1].simHit! >= batch.results[2].simHit!);
    // Odds echoed unchanged.
    assert.equal(batch.results[0].providerOddsAmerican, -110);
  });

  it("is deterministic for same seed", () => {
    const t1 = buildFixtureScenarioTensor({ sport: "nfl", eventId: "e1", seed: "det", nDraws: 500 });
    const t2 = buildFixtureScenarioTensor({ sport: "nfl", eventId: "e1", seed: "det", nDraws: 500 });
    const m = totalMarket(41.5, "m");
    const o = oddsFor("m", -110);
    const r1 = settleMarket({ tensor: t1, market: m, odds: o, allowFixture: true });
    const r2 = settleMarket({ tensor: t2, market: m, odds: o, allowFixture: true });
    assert.equal(r1.simHit, r2.simHit);
    assert.equal(r1.dataFingerprint, r2.dataFingerprint);
  });
});
