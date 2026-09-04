import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS,
  COACH_SNAPSHOT_MAX_AGE_MS,
} from "@workspace/coach-types";
import type { CoachQualifiedLegPool, CoachRankedLeg } from "@workspace/coach-types";
import { fixtures } from "../../coach-types/src/fixtures/index.ts";
import { rankQualifiedPool } from "@workspace/coach-rank";

import {
  buildCoachSnapshot,
  buildCoachV2SlateResponse,
  buildTicketsIndex,
  CoachSnapshotCache,
  evaluateSnapshotFreshness,
  getTicketFromSnapshot,
  InMemorySnapshotStore,
  isSnapshotFresh,
  isSnapshotInstantServeable,
  snapshotAgeMs,
} from "../src/index";

function rankedLeg(
  overrides: Partial<CoachRankedLeg> &
    Pick<CoachRankedLeg, "kind" | "pick" | "edgePct" | "gameId">,
): CoachRankedLeg {
  return {
    legId: `l-${overrides.pick}`,
    legFingerprint: `fp:${overrides.pick}`,
    sport: "mlb",
    gameLabel: "NYY @ BOS",
    marketKey: overrides.kind === "player_prop" ? "batter_hits" : "spreads",
    marketLabel: overrides.kind === "player_prop" ? "Hits" : "Run Line",
    odds: -110,
    line: overrides.kind === "player_prop" ? 1.5 : -1.5,
    startsAt: "2026-07-12T23:00:00.000Z",
    isAlt: false,
    simHitPct: 56,
    evPct: 4,
    confidencePct: 58,
    compositeScore: 72,
    grade: "B",
    gateEvaluation: {
      legFingerprint: `fp:${overrides.pick}`,
      sport: "mlb",
      results: [],
      allPassed: true,
      failedGateId: null,
    },
    rankScore: 80,
    rankPosition: 1,
    learningMultiplier: 1,
    confidenceAdjustmentPct: 0,
    effectiveConfidencePct: 58,
    ...overrides,
  };
}

const pool: CoachQualifiedLegPool = {
  manifest: fixtures.scanManifest,
  props: [
    rankedLeg({
      kind: "player_prop",
      pick: "Over 1.5",
      edgePct: 4.2,
      gameId: "g1",
      playerId: "p1",
      playerName: "Judge",
      rankScore: 88,
    }),
    rankedLeg({
      kind: "player_prop",
      pick: "Over 0.5",
      edgePct: 3.8,
      gameId: "g2",
      playerId: "p2",
      playerName: "Soto",
      rankScore: 82,
    }),
    rankedLeg({
      kind: "player_prop",
      pick: "Over 2.5",
      edgePct: 5.2,
      gameId: "g3",
      playerId: "p3",
      playerName: "Ohtani",
      rankScore: 78,
    }),
  ],
  gameLines: [
    rankedLeg({
      kind: "game_line",
      pick: "NYY -1.5",
      edgePct: 9.5,
      gameId: "g4",
      rankScore: 70,
    }),
  ],
};

describe("coach-cache freshness", () => {
  const baseAt = 1_752_955_473_000;

  it("marks snapshot fresh within max age", () => {
    const snapshot = { ...fixtures.snapshot, at: baseAt };
    assert.equal(isSnapshotFresh(snapshot, baseAt + 5 * 60_000), true);
    assert.equal(isSnapshotFresh(snapshot, baseAt + COACH_SNAPSHOT_MAX_AGE_MS + 1), false);
  });

  it("allows instant serve in extended stale window", () => {
    const snapshot = { ...fixtures.snapshot, at: baseAt, serveable: true };
    const staleButOk = baseAt + COACH_SNAPSHOT_MAX_AGE_MS + 60_000;
    assert.equal(isSnapshotInstantServeable(snapshot, staleButOk), true);
    assert.equal(
      isSnapshotInstantServeable(snapshot, baseAt + COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS + 1),
      false,
    );
  });

  it("reports age in milliseconds", () => {
    const snapshot = { ...fixtures.snapshot, at: baseAt };
    assert.equal(snapshotAgeMs(snapshot, baseAt + 120_000), 120_000);
  });
});

describe("coach-cache build", () => {
  it("precomputes global and per-sport tickets for all parlay sizes", () => {
    const ranked = rankQualifiedPool(pool);
    const nowMs = 1_752_955_473_000;
    const index = buildTicketsIndex({
      ranked,
      manifest: pool.manifest,
      fingerprint: pool.manifest.contextFingerprint,
      activeSports: ["mlb"],
      nowMs,
    });

    assert.ok(index.global[3]);
    assert.ok(index.global[5]);
    assert.ok(index.global[15]);
    assert.ok(index.bySport.mlb?.[5]);
    assert.ok(index.global[9]!.deliveredLegs <= 9);
  });

  it("marks snapshot serveable only when scan complete with delivered legs", () => {
    const ranked = rankQualifiedPool(pool);
    const snapshot = buildCoachSnapshot({
      ranked,
      manifest: pool.manifest,
      fingerprint: pool.manifest.contextFingerprint,
      activeSports: ["mlb"],
      nowMs: 1_752_955_473_000,
    });

    assert.equal(snapshot.fingerprint, pool.manifest.contextFingerprint);
    assert.equal(snapshot.serveable, true);
    assert.equal(snapshot.deepSimComplete, true);
  });
});

describe("coach-cache lookup", () => {
  it("reads precomputed tickets by leg count and sport", () => {
    const ticket = getTicketFromSnapshot(fixtures.snapshot, 5);
    assert.ok(ticket);
    assert.equal(ticket.requestedLegs, 5);

    const mlbTicket = getTicketFromSnapshot(fixtures.snapshot, 5, "mlb");
    assert.ok(mlbTicket);

    assert.equal(getTicketFromSnapshot(fixtures.snapshot, 7), null);
  });
});

describe("coach-cache store", () => {
  it("returns cache hit for same fingerprint within instant-serve window", async () => {
    const store = new InMemorySnapshotStore();
    const cache = new CoachSnapshotCache(store);
    const at = 1_752_955_473_000;
    const fingerprint = "ctx:mlb:stable";

    await cache.put({ ...fixtures.snapshot, at, fingerprint });

    const hit = await cache.getIfCurrent({
      contextFingerprint: fingerprint,
      nowMs: at + 60_000,
    });
    assert.ok(hit);
    assert.equal(hit.fingerprint, fingerprint);
  });

  it("cache miss when odds fingerprint changes", async () => {
    const store = new InMemorySnapshotStore();
    const cache = new CoachSnapshotCache(store);
    const at = 1_752_955_473_000;

    await cache.put({ ...fixtures.snapshot, at, fingerprint: "ctx:odds:v1" });

    const miss = await cache.getIfCurrent({
      contextFingerprint: "ctx:odds:v2",
      nowMs: at + 60_000,
    });
    assert.equal(miss, null);
  });

  it("cache miss when snapshot exceeds instant-serve max age", async () => {
    const store = new InMemorySnapshotStore();
    const cache = new CoachSnapshotCache(store);
    const at = 1_752_955_473_000;
    const fingerprint = "ctx:mlb:stale";

    await cache.put({ ...fixtures.snapshot, at, fingerprint });

    const miss = await cache.getIfCurrent({
      contextFingerprint: fingerprint,
      nowMs: at + COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS + 1,
    });
    assert.equal(miss, null);
  });

  it("buildAndStore writes a serveable snapshot", async () => {
    const store = new InMemorySnapshotStore();
    const cache = new CoachSnapshotCache(store);
    const ranked = rankQualifiedPool(pool);

    const snapshot = await cache.buildAndStore({
      ranked,
      manifest: pool.manifest,
      fingerprint: pool.manifest.contextFingerprint,
      activeSports: ["mlb"],
      nowMs: 1_752_955_473_000,
    });

    const loaded = await cache.get();
    assert.ok(loaded);
    assert.equal(loaded.fingerprint, snapshot.fingerprint);
    assert.equal(loaded.serveable, true);
  });
});

describe("coach-cache serve", () => {
  it("builds v2 slate response with fresh and instantServe flags", () => {
    const at = 1_752_955_473_000;
    const snapshot = { ...fixtures.snapshot, at };
    const fresh = buildCoachV2SlateResponse({ snapshot, nowMs: at + 60_000 });
    assert.equal(fresh.fresh, true);
    assert.equal(fresh.instantServe, true);
    assert.equal(fresh.snapshot?.fingerprint, fixtures.snapshot.fingerprint);

    const stale = buildCoachV2SlateResponse({
      snapshot,
      nowMs: at + COACH_SNAPSHOT_MAX_AGE_MS + 60_000,
      refreshing: true,
    });
    assert.equal(stale.fresh, false);
    assert.equal(stale.instantServe, true);
    assert.equal(stale.refreshing, true);

    const empty = buildCoachV2SlateResponse({ snapshot: null });
    assert.equal(empty.snapshot, null);
    assert.equal(empty.fresh, false);
  });

  it("evaluates combined freshness state", () => {
    const at = 1_752_955_473_000;
    const snapshot = { ...fixtures.snapshot, at };
    const state = evaluateSnapshotFreshness(snapshot, at + 120_000);
    assert.equal(state.fresh, true);
    assert.equal(state.instantServe, true);
    assert.equal(state.serveable, true);
  });
});
