import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enrichPropSimResults,
  enrichSimMapWithLocalFallback,
  filterRealPropsWithSimSupport,
  localPropSimulation,
} from "./propSimFallback.ts";

const hitsHistory = {
  recent: [
    { stats: { H: "2" } },
    { stats: { H: "1" } },
    { stats: { H: "2" } },
    { stats: { H: "0" } },
    { stats: { H: "1" } },
  ],
};

test("localPropSimulation fills hit %, likely line, and confidence from game log", () => {
  const local = localPropSimulation(hitsHistory, {
    player: "Test Player",
    market: "batter_hits",
    line: 1.5,
    side: "Over",
  });
  assert.ok(local);
  assert.equal(local!.sampleGames, 5);
  assert.ok(local!.hitProbability != null);
  assert.equal(local!.mostLikelyLine, 1);
  assert.ok(local!.confidenceScore != null && local!.confidenceScore >= 5);
});

test("enrichPropSimResults replaces null server sim with game-log fallback", () => {
  const rows = enrichPropSimResults(
    [
      {
        key: "Test Player|batter_hits|1.5|Over",
        player: "Test Player",
        market: "batter_hits",
        line: 1.5,
        side: "Over",
        simulations: 0,
        hitProbability: null,
        mostLikelyLine: null,
        meanProjection: null,
        medianProjection: null,
        confidenceScore: null,
        stdDev: null,
        sampleGames: 0,
        percentiles: null,
        tier: "quick",
        cached: false,
      },
    ],
    { "Test Player#123": hitsHistory },
  );
  assert.ok(rows[0]!.hitProbability != null);
  assert.ok(rows[0]!.mostLikelyLine != null);
  assert.ok(rows[0]!.confidenceScore != null);
});

test("filterRealPropsWithSimSupport drops props without sim or fallback", () => {
  const sims = enrichSimMapWithLocalFallback(
    new Map(),
    [{ player: "Test Player", market: "batter_hits", line: 1.5, side: "Over", athleteId: "123" }],
    { "Test Player#123": hitsHistory },
  );
  const kept = filterRealPropsWithSimSupport(
    [
      {
        player: "Test Player",
        market: "batter_hits",
        line: 1.5,
        over: -110,
        under: -110,
        evSide: "Over",
        athleteId: "123",
      } as any,
      {
        player: "No History",
        market: "batter_hits",
        line: 1.5,
        over: -110,
        under: -110,
        evSide: "Over",
      } as any,
    ],
    sims,
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.player, "Test Player");
});
