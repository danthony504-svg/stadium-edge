import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CoachSimResult } from "@workspace/coach-types";

import { CoachSimCache, InMemorySimCacheStore } from "../src/index";

function sampleResult(fingerprint: string): CoachSimResult {
  return {
    legFingerprint: fingerprint,
    tier: "deep",
    iterations: 10_000,
    hitProbability: 0.56,
    evPct: 4.2,
    edgePct: 3.1,
    computedAt: "2026-07-12T22:00:00.000Z",
  };
}

describe("coach-sim-cache", () => {
  it("returns cache hit for same legFingerprint", async () => {
    const store = new InMemorySimCacheStore();
    const cache = new CoachSimCache(store);
    let runs = 0;

    const first = await cache.getOrSimulate({
      legFingerprint: "fp:1",
      contextFingerprint: "ctx:1",
      simulate: async () => {
        runs += 1;
        return sampleResult("fp:1");
      },
    });
    const second = await cache.getOrSimulate({
      legFingerprint: "fp:1",
      contextFingerprint: "ctx:1",
      simulate: async () => {
        runs += 1;
        return sampleResult("fp:1");
      },
    });

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(runs, 1);
  });

  it("cache miss when legFingerprint changes (odds movement)", async () => {
    const store = new InMemorySimCacheStore();
    const cache = new CoachSimCache(store);
    let runs = 0;

    await cache.getOrSimulate({
      legFingerprint: "fp:odds:-110",
      contextFingerprint: "ctx:1",
      simulate: async () => {
        runs += 1;
        return sampleResult("fp:odds:-110");
      },
    });
    await cache.getOrSimulate({
      legFingerprint: "fp:odds:-105",
      contextFingerprint: "ctx:1",
      simulate: async () => {
        runs += 1;
        return sampleResult("fp:odds:-105");
      },
    });

    assert.equal(runs, 2);
    assert.equal(store.stats().size, 2);
  });
});
