import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCoachSlate } from "@workspace/coach-data";
import { createDefaultSportRegistry } from "@workspace/coach-data/sports";
import { CoachSimService } from "@workspace/coach-sim";
import { InMemorySimCacheStore } from "@workspace/coach-sim-cache";
import { CoachSnapshotCache, InMemorySnapshotStore } from "@workspace/coach-cache";
import { COACH_SNAPSHOT_MAX_AGE_MS } from "@workspace/coach-types";
import type { CoachSportContext } from "@workspace/coach-types";
import type { CoachGateEvaluationContext } from "@workspace/coach-gates";

import {
  coachBackgroundTick,
  InMemoryScanStatusStore,
  runCoachBackgroundPipeline,
  shouldRunBackgroundRefresh,
} from "../src/index";

const NOW = Date.parse("2026-07-12T18:00:00.000Z");

const rawSlate = {
  games: [
    {
      sport: "mlb",
      gameId: "g1",
      gameLabel: "NYY @ BOS",
      startsAt: "2026-07-12T23:00:00.000Z",
      status: "scheduled",
    },
  ],
  gameLines: [
    {
      sport: "mlb",
      gameId: "g1",
      gameLabel: "NYY @ BOS",
      marketKey: "h2h",
      marketLabel: "Moneyline",
      pick: "NYY ML",
      odds: -120,
      line: null,
      startsAt: "2026-07-12T23:00:00.000Z",
      isAlt: false,
    },
  ],
  props: [
    {
      sport: "mlb",
      gameId: "g1",
      gameLabel: "NYY @ BOS",
      marketKey: "batter_hits",
      marketLabel: "Hits",
      playerId: "p1",
      playerName: "Aaron Judge",
      pick: "Over 1.5",
      odds: -110,
      line: 1.5,
      side: "Over" as const,
      startsAt: "2026-07-12T23:00:00.000Z",
      isAlt: false,
    },
    {
      sport: "mlb",
      gameId: "g1",
      gameLabel: "NYY @ BOS",
      marketKey: "batter_hits",
      marketLabel: "Hits",
      playerId: "p2",
      playerName: "Juan Soto",
      pick: "Over 0.5",
      odds: -130,
      line: 0.5,
      side: "Over" as const,
      startsAt: "2026-07-12T23:00:00.000Z",
      isAlt: true,
    },
  ],
};

const passingGateContext: CoachGateEvaluationContext = {
  trends: { momentum: 0.3, sampleSize: 5 },
  injuries: { favor: 0.1 },
  lineMovement: { direction: "neutral" },
};

const sportContext: CoachSportContext = {
  sport: "mlb",
  injuries: {},
  matchupHistory: {},
  playerHistory: {},
  lineMovement: {},
  trends: {},
};

function createDeps(hitByPlayer: Record<string, number> = { "Aaron Judge": 0.58, "Juan Soto": 0.57 }) {
  const sim = new CoachSimService({
    store: new InMemorySimCacheStore(),
    executePropSim: async ({ props }) => {
      const player = props[0]?.player ?? "";
      const hit = hitByPlayer[player] ?? 0.5;
      return {
        props: [
          {
            simulations: 10_000,
            hitProbability: hit,
            confidenceScore: hit >= 0.55 ? 58 : 48,
          },
        ],
      };
    },
  });
  const snapshotCache = new CoachSnapshotCache(new InMemorySnapshotStore());
  const registry = createDefaultSportRegistry();
  const statusStore = new InMemoryScanStatusStore();
  return { sim, snapshotCache, registry, statusStore };
}

describe("coach-background refresh", () => {
  it("requires refresh when snapshot is missing", () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const decision = shouldRunBackgroundRefresh({
      snapshot: null,
      contextFingerprint: slate.contextFingerprint,
      nowMs: NOW,
    });
    assert.equal(decision.refresh, true);
    assert.equal(decision.reason, "missing");
  });

  it("requires refresh when odds fingerprint changes", async () => {
    const { snapshotCache } = createDeps();
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    await snapshotCache.put({
      at: NOW,
      fingerprint: "old-fingerprint",
      manifest: {
        contextFingerprint: "old-fingerprint",
        scanStartedAt: new Date(NOW).toISOString(),
        scanCompletedAt: new Date(NOW).toISOString(),
        phase: "complete",
        sports: ["mlb"],
        marketsPosted: 1,
        marketsSeen: 1,
        propsPosted: 1,
        propsSeen: 1,
        gameLinesPosted: 1,
        gameLinesSeen: 1,
        altLinesPosted: 0,
        altLinesSeen: 0,
        candidatesEvaluated: 2,
        simCacheHits: 0,
        simCacheMisses: 2,
        deepSimComplete: true,
        scanComplete: true,
        gatesPassed: 1,
        gatesRejected: 1,
        rejectionBreakdown: {},
      },
      tickets: { global: {}, bySport: {} },
      activeSports: ["mlb"],
      deepSimComplete: true,
      propsQualified: 1,
      gameLinesQualified: 0,
      serveable: true,
    });

    const decision = shouldRunBackgroundRefresh({
      snapshot: await snapshotCache.get(),
      contextFingerprint: slate.contextFingerprint,
      nowMs: NOW,
    });
    assert.equal(decision.refresh, true);
    assert.equal(decision.reason, "fingerprint_changed");
  });

  it("skips refresh when fingerprint matches and snapshot is fresh", async () => {
    const { snapshotCache } = createDeps();
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    await snapshotCache.put({
      at: NOW,
      fingerprint: slate.contextFingerprint,
      manifest: {
        contextFingerprint: slate.contextFingerprint,
        scanStartedAt: new Date(NOW).toISOString(),
        scanCompletedAt: new Date(NOW).toISOString(),
        phase: "complete",
        sports: ["mlb"],
        marketsPosted: 1,
        marketsSeen: 1,
        propsPosted: 2,
        propsSeen: 2,
        gameLinesPosted: 1,
        gameLinesSeen: 1,
        altLinesPosted: 1,
        altLinesSeen: 1,
        candidatesEvaluated: 2,
        simCacheHits: 0,
        simCacheMisses: 2,
        deepSimComplete: true,
        scanComplete: true,
        gatesPassed: 2,
        gatesRejected: 0,
        rejectionBreakdown: {},
      },
      tickets: {
        global: {
          3: {
            requestedLegs: 3,
            deliveredLegs: 1,
            picks: [],
            propCount: 1,
            gameLineCount: 0,
            assembledAt: new Date(NOW).toISOString(),
          },
        },
        bySport: {},
      },
      activeSports: ["mlb"],
      deepSimComplete: true,
      propsQualified: 1,
      gameLinesQualified: 0,
      serveable: true,
    });

    const decision = shouldRunBackgroundRefresh({
      snapshot: await snapshotCache.get(),
      contextFingerprint: slate.contextFingerprint,
      nowMs: NOW + 60_000,
    });
    assert.equal(decision.refresh, false);
    assert.equal(decision.reason, "fresh");
  });

  it("requires refresh when snapshot is stale", async () => {
    const { snapshotCache } = createDeps();
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    await snapshotCache.put({
      at: NOW,
      fingerprint: slate.contextFingerprint,
      manifest: {
        contextFingerprint: slate.contextFingerprint,
        scanStartedAt: new Date(NOW).toISOString(),
        scanCompletedAt: new Date(NOW).toISOString(),
        phase: "complete",
        sports: ["mlb"],
        marketsPosted: 1,
        marketsSeen: 1,
        propsPosted: 1,
        propsSeen: 1,
        gameLinesPosted: 1,
        gameLinesSeen: 1,
        altLinesPosted: 0,
        altLinesSeen: 0,
        candidatesEvaluated: 1,
        simCacheHits: 0,
        simCacheMisses: 1,
        deepSimComplete: true,
        scanComplete: true,
        gatesPassed: 1,
        gatesRejected: 0,
        rejectionBreakdown: {},
      },
      tickets: { global: {}, bySport: {} },
      activeSports: ["mlb"],
      deepSimComplete: true,
      propsQualified: 1,
      gameLinesQualified: 0,
      serveable: true,
    });

    const decision = shouldRunBackgroundRefresh({
      snapshot: await snapshotCache.get(),
      contextFingerprint: slate.contextFingerprint,
      nowMs: NOW + COACH_SNAPSHOT_MAX_AGE_MS + 1,
    });
    assert.equal(decision.refresh, true);
    assert.equal(decision.reason, "stale");
  });
});

describe("coach-background pipeline", () => {
  it("runs full scan and stores a serveable snapshot", async () => {
    const { sim, snapshotCache, registry } = createDeps();
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });

    const snapshot = await runCoachBackgroundPipeline({
      slate,
      registry,
      sim,
      snapshotCache,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW,
    });

    assert.equal(snapshot.fingerprint, slate.contextFingerprint);
    assert.equal(snapshot.manifest.scanComplete, true);
    assert.equal(snapshot.serveable, true);
    assert.ok(snapshot.tickets.global[3]);
    assert.ok(snapshot.tickets.global[5]);
  });
});

describe("coach-background tick", () => {
  it("skips cron work when snapshot is fresh for current slate", async () => {
    const { sim, snapshotCache, registry, statusStore } = createDeps();
    const first = await coachBackgroundTick({
      rawSlate,
      registry,
      sim,
      snapshotCache,
      statusStore,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW,
    });
    assert.equal(first.outcome, "refreshed");
    assert.ok(first.snapshot);

    const second = await coachBackgroundTick({
      rawSlate,
      registry,
      sim,
      snapshotCache,
      statusStore,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW + 30_000,
    });
    assert.equal(second.outcome, "skipped_fresh");
    assert.equal(second.snapshot?.fingerprint, first.snapshot?.fingerprint);
    assert.equal(second.status.jobRunning, false);
  });

  it("skips when a job is already running", async () => {
    const { sim, snapshotCache, registry, statusStore } = createDeps();
    await statusStore.set({
      jobRunning: true,
      manifest: null,
      lastError: null,
      updatedAt: new Date(NOW).toISOString(),
    });

    const result = await coachBackgroundTick({
      rawSlate,
      registry,
      sim,
      snapshotCache,
      statusStore,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW,
    });

    assert.equal(result.outcome, "skipped_running");
    assert.equal(result.status.jobRunning, true);
  });

  it("refreshes when odds change between ticks", async () => {
    const { sim, snapshotCache, registry, statusStore } = createDeps();
    await coachBackgroundTick({
      rawSlate,
      registry,
      sim,
      snapshotCache,
      statusStore,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW,
    });

    const changedOdds = {
      ...rawSlate,
      props: rawSlate.props.map((p) =>
        p.playerName === "Aaron Judge" ? { ...p, odds: -105 } : p,
      ),
    };

    const refreshed = await coachBackgroundTick({
      rawSlate: changedOdds,
      registry,
      sim,
      snapshotCache,
      statusStore,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW + COACH_SNAPSHOT_MAX_AGE_MS + 5_000,
    });

    assert.equal(refreshed.outcome, "refreshed");
    assert.notEqual(
      refreshed.snapshot?.fingerprint,
      normalizeCoachSlate(rawSlate, { nowMs: NOW }).contextFingerprint,
    );
  });

  it("preserves prior snapshot and records error on pipeline failure", async () => {
    const { snapshotCache, registry, statusStore } = createDeps();
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    await snapshotCache.put({
      at: NOW - COACH_SNAPSHOT_MAX_AGE_MS - 1,
      fingerprint: slate.contextFingerprint,
      manifest: {
        contextFingerprint: slate.contextFingerprint,
        scanStartedAt: new Date(NOW).toISOString(),
        scanCompletedAt: new Date(NOW).toISOString(),
        phase: "complete",
        sports: ["mlb"],
        marketsPosted: 1,
        marketsSeen: 1,
        propsPosted: 1,
        propsSeen: 1,
        gameLinesPosted: 1,
        gameLinesSeen: 1,
        altLinesPosted: 0,
        altLinesSeen: 0,
        candidatesEvaluated: 1,
        simCacheHits: 0,
        simCacheMisses: 1,
        deepSimComplete: true,
        scanComplete: true,
        gatesPassed: 1,
        gatesRejected: 0,
        rejectionBreakdown: {},
      },
      tickets: { global: {}, bySport: {} },
      activeSports: ["mlb"],
      deepSimComplete: true,
      propsQualified: 1,
      gameLinesQualified: 0,
      serveable: true,
    });

    const failingSim = new CoachSimService({
      store: new InMemorySimCacheStore(),
      executePropSim: async () => {
        throw new Error("sim provider unavailable");
      },
    });

    const failed = await coachBackgroundTick({
      rawSlate,
      registry,
      sim: failingSim,
      snapshotCache,
      statusStore,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
      nowMs: NOW,
    });

    assert.equal(failed.outcome, "failed");
    assert.equal(failed.error, "sim provider unavailable");
    assert.equal(failed.snapshot?.fingerprint, slate.contextFingerprint);
    assert.equal(failed.status.jobRunning, false);
    assert.equal(failed.status.lastError, "sim provider unavailable");
  });
});
