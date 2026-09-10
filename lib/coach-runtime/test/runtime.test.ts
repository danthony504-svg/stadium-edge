import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCoachSlate } from "@workspace/coach-data";
import { createDefaultSportRegistry } from "@workspace/coach-data/sports";
import { CoachSimService } from "@workspace/coach-sim";
import { InMemorySimCacheStore } from "@workspace/coach-sim-cache";
import { CoachSnapshotCache, InMemorySnapshotStore } from "@workspace/coach-cache";
import { COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS } from "@workspace/coach-types";
import type { CoachSportContext } from "@workspace/coach-types";
import type { CoachGateEvaluationContext } from "@workspace/coach-gates";
import { fixtures } from "../../coach-types/src/fixtures/index.ts";

import {
  buildTicketResponseFromSnapshot,
  CoachRuntime,
  nearestParlaySize,
  parseLegsQuery,
  parseSportQuery,
} from "../src/index";
import { InMemoryScanStatusStore } from "@workspace/coach-background";
import type { CoachSlateLoader } from "../src/slateLoader";

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

function createRuntime(hitByPlayer: Record<string, number> = { "Aaron Judge": 0.58, "Juan Soto": 0.57 }) {
  const slateLoader: CoachSlateLoader = {
    load: async () => rawSlate,
  };
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
  const statusStore = new InMemoryScanStatusStore();
  const runtime = new CoachRuntime({
    snapshotCache,
    statusStore,
    slateLoader,
    registry: createDefaultSportRegistry(),
    sim,
    sportContext,
    resolveGateContext: () => passingGateContext,
    sports: ["mlb"],
  });
  return { runtime, snapshotCache, statusStore };
}

describe("coach-runtime parse", () => {
  it("parses legs and sport query params", () => {
    assert.equal(parseLegsQuery("9"), 9);
    assert.equal(parseLegsQuery("2"), undefined);
    assert.equal(parseSportQuery("mlb"), "mlb");
    assert.equal(parseSportQuery("all"), null);
    assert.equal(nearestParlaySize(8), 9);
  });
});

describe("coach-runtime ticket response", () => {
  it("builds ticket response with shortfall from snapshot", () => {
    const response = buildTicketResponseFromSnapshot(fixtures.snapshot, 5);
    assert.ok(response);
    assert.equal(response.ticket.requestedLegs, 5);
    assert.equal(response.ready, true);
  });
});

describe("coach-runtime service", () => {
  it("runs cron tick and serves slate response", async () => {
    const { runtime } = createRuntime();
    const tick = await runtime.runCronTick(NOW);
    assert.equal(tick.outcome, "refreshed");
    assert.ok(tick.snapshot?.serveable);

    const slate = await runtime.getSlate(NOW + 30_000);
    assert.equal(slate.fresh, true);
    assert.ok(slate.snapshot);
    assert.equal(slate.refreshing, false);
  });

  it("returns ticket for precomputed leg count", async () => {
    const { runtime } = createRuntime();
    await runtime.runCronTick(NOW);
    const ticket = await runtime.getTicket({ legs: 5 }, NOW + 30_000);
    assert.ok(ticket);
    assert.equal(ticket.ticket.requestedLegs, 5);
    assert.ok(ticket.ticket.deliveredLegs > 0);
  });

  it("skips duplicate refresh on fresh snapshot GET", async () => {
    const { runtime } = createRuntime();
    await runtime.runCronTick(NOW);
    let tickCount = 0;
    const original = runtime.runCronTick.bind(runtime);
    runtime.runCronTick = async (...args) => {
      tickCount += 1;
      return original(...args);
    };

    await runtime.getSlate(NOW + 30_000);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(tickCount, 0);
  });

  it("exposes scan status after cron", async () => {
    const { runtime } = createRuntime();
    await runtime.runCronTick(NOW);
    const status = await runtime.getScanStatus();
    assert.equal(status.jobRunning, false);
    assert.equal(status.lastError, null);
    assert.equal(status.manifest?.scanComplete, true);
  });

  it("returns null ticket when snapshot is too stale", async () => {
    const { runtime, snapshotCache } = createRuntime();
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    await snapshotCache.put({
      ...fixtures.snapshot,
      at: NOW,
      fingerprint: slate.contextFingerprint,
      serveable: true,
    });
    const ticket = await runtime.getTicket({ legs: 5 }, NOW + COACH_SNAPSHOT_INSTANT_SERVE_MAX_MS + 60_000);
    assert.equal(ticket, null);
  });
});
