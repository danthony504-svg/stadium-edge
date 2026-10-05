/**
 * Phase 2.3 equivalence — propsim history shape from authoritative loader
 * matches legacy field contract (no enrich-only fields leaking into MC).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toPropSimHistoryShape,
  toEnrichmentHistory,
  type AuthoritativePlayerHistory,
} from "../src/lib/authoritativePlayerHistory.ts";
import { buildPropSimulationContext, simulateProp } from "../src/lib/monteCarloBuild.ts";

function sampleAuth(): AuthoritativePlayerHistory {
  return {
    sport: "mlb",
    athleteId: "33481",
    labels: ["H", "AB", "HR"],
    loadedAtMs: Date.now(),
    flat: [
      { eventId: "1", date: "2026-10-01", opponentId: "10", opponentName: "NYY", isHome: true, stats: { H: "2", AB: "4", HR: "1" } },
      { eventId: "2", date: "2026-09-30", opponentId: "11", opponentName: "BOS", isHome: false, stats: { H: "1", AB: "3", HR: "0" } },
      { eventId: "3", date: "2026-09-29", opponentId: "12", opponentName: "TOR", isHome: true, stats: { H: "0", AB: "4", HR: "0" } },
      { eventId: "4", date: "2026-09-28", opponentId: "13", opponentName: "BAL", isHome: false, stats: { H: "3", AB: "5", HR: "1" } },
      { eventId: "5", date: "2026-09-27", opponentId: "14", opponentName: "TB", isHome: true, stats: { H: "1", AB: "4", HR: "0" } },
      { eventId: "6", date: "2026-09-26", opponentId: "10", opponentName: "NYY", isHome: false, stats: { H: "2", AB: "4", HR: "0" } },
    ],
  };
}

describe("Phase 2.3 MC equivalence from shared history", () => {
  it("two derivations from same auth history yield identical hitProbability", () => {
    const auth = sampleAuth();
    const h1 = toPropSimHistoryShape(auth);
    const h2 = toPropSimHistoryShape(auth);
    assert.deepEqual(h1, h2);

    const req = {
      player: "Test",
      sport: "mlb",
      market: "batter_hits",
      line: 0.5,
      side: "Over" as const,
      athleteId: "33481",
      isHome: true as const,
    };
    const game = {
      sport: "mlb",
      oppPace: null,
      leaguePace: null,
      oppKeyInjuries: 0,
      ownKeyInjuries: 0,
      weatherImpact: null,
    };
    const a = simulateProp(req, h1, game, 10_000, { seed: 42 });
    const b = simulateProp(req, h2, game, 10_000, { seed: 42 });
    assert.equal(a.hitProbability, b.hitProbability);
    assert.equal(a.meanProjection, b.meanProjection);
    assert.equal(a.confidenceScore, b.confidenceScore);
    assert.equal(a.stdDev, b.stdDev);

    const ctx1 = buildPropSimulationContext(req, h1, game);
    const ctx2 = buildPropSimulationContext(req, h2, game);
    assert.deepEqual(ctx1?.recentValues, ctx2?.recentValues);
  });

  it("enrichment projection preserves material grading fields from same auth source", () => {
    const auth = sampleAuth();
    const enrich = toEnrichmentHistory(auth, "10");
    const shape = toPropSimHistoryShape(auth, "10");
    assert.equal(enrich.recent.length, shape.recent.length);
    for (let i = 0; i < shape.recent.length; i++) {
      assert.deepEqual(enrich.recent[i]!.stats, shape.recent[i]!.stats);
      assert.equal(enrich.recent[i]!.isHome, shape.recent[i]!.isHome);
      assert.equal(enrich.recent[i]!.opponentId, shape.recent[i]!.opponentId);
    }
    assert.equal(enrich.vsOpponent.length, shape.vsOpponent.length);
    assert.ok(enrich.recent[0]!.date);
    assert.ok(enrich.recent[0]!.opponentName);
  });
});
