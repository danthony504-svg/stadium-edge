import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFixtureScenarioTensor,
  impliedProbFromAmerican,
  settleAltLineBatch,
  summarizeLatency,
  type SimV2Market,
} from "../src/index.js";

const now = new Date().toISOString();
const provenance = [{ provider: "fixture", fetchedAt: now }];

describe("Phase A performance overhead", () => {
  it("alt-line batch settle on 10k fixture tensor stays cheap vs full re-sim cost model", () => {
    const tensor = buildFixtureScenarioTensor({
      sport: "nfl",
      eventId: "perf",
      seed: "perf-seed",
      nDraws: 10_000,
    });

    const lines = [38.5, 40.5, 42.5, 44.5, 46.5, 48.5, 50.5, 52.5];
    const markets: SimV2Market[] = lines.map((line, i) => ({
      marketId: `m${i}`,
      eventId: "perf",
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
    }));

    const oddsByMarketId = Object.fromEntries(
      markets.map((m) => [
        m.marketId,
        {
          marketId: m.marketId,
          american: -110,
          book: "test",
          capturedAt: now,
          impliedProbRaw: impliedProbFromAmerican(-110),
          provenance: provenance[0],
        },
      ]),
    );

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const batch = settleAltLineBatch({
        tensor,
        markets,
        oddsByMarketId,
        allowFixture: true,
      });
      samples.push(batch.settleLatencyMs);
      assert.equal(batch.reusedSingleTensor, true);
      assert.equal(batch.results.length, lines.length);
    }

    const stats = summarizeLatency(samples);
    // Soft local gate: batch of 8 lines on 10k draws should be well under 200ms mean in CI.
    assert.ok(stats.meanMs != null && stats.meanMs < 200, `meanMs=${stats.meanMs}`);
    assert.ok(stats.p95Ms != null && stats.p95Ms < 400, `p95Ms=${stats.p95Ms}`);
  });
});
