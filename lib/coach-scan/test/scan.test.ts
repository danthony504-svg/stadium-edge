import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCoachSlate } from "@workspace/coach-data";
import { createDefaultSportRegistry } from "@workspace/coach-data/sports";
import { CoachSimService } from "@workspace/coach-sim";
import { InMemorySimCacheStore } from "@workspace/coach-sim-cache";
import type { CoachSportContext } from "@workspace/coach-types";
import type { CoachGateEvaluationContext } from "@workspace/coach-gates";

import { countSlateInventory, enumerateAllCandidates, runCoachScan } from "../src/index";

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
    {
      sport: "wnba",
      gameId: "g2",
      gameLabel: "Chicago Sky @ Dallas Wings",
      startsAt: "2026-07-12T20:00:00.000Z",
      status: "scheduled",
    },
  ],
  gameLines: [
    {
      sport: "wnba",
      gameId: "g2",
      gameLabel: "Chicago Sky @ Dallas Wings",
      marketKey: "h2h",
      marketLabel: "Moneyline",
      pick: "Dallas Wings ML",
      odds: -435,
      line: null,
      startsAt: "2026-07-12T20:00:00.000Z",
      isAlt: false,
    },
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

function createSimService(
  hitByPlayer: Record<string, number>,
): CoachSimService {
  return new CoachSimService({
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
}

describe("coach-scan enumerate", () => {
  it("enumerates all posted candidates without stopping early", () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const registry = createDefaultSportRegistry();
    const legs = enumerateAllCandidates(registry, slate);
    assert.equal(legs.length, 3);
    assert.equal(legs.filter((l) => l.kind === "player_prop").length, 2);
    assert.equal(legs.filter((l) => l.kind === "game_line").length, 1);
  });

  it("counts posted inventory for manifest", () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const counts = countSlateInventory(slate);
    assert.equal(counts.propsPosted, 2);
    assert.equal(counts.gameLinesPosted, 2);
    assert.equal(counts.altLinesPosted, 1);
    assert.equal(counts.marketsPosted, 3);
  });
});

describe("coach-scan runCoachScan", () => {
  it("rejects negative-edge legs like legacy Wings -435 chalk", async () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const registry = createDefaultSportRegistry();
    const sim = createSimService({
      "Aaron Judge": 0.52,
      "Juan Soto": 0.58,
    });

    const pool = await runCoachScan({
      slate,
      registry,
      sim,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
    });

    assert.equal(pool.manifest.scanComplete, true);
    assert.equal(pool.manifest.propsPosted, pool.manifest.propsSeen);
    assert.equal(pool.manifest.candidatesEvaluated, 3);
    assert.ok(pool.manifest.gatesRejected >= 2);
    assert.ok(pool.props.every((p) => p.edgePct > 0));
    assert.equal(pool.props.length, 1);
    assert.equal(pool.props[0]?.playerName, "Juan Soto");
  });

  it("qualifies props that pass all gates and assigns grades", async () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const registry = createDefaultSportRegistry();
    const sim = createSimService({
      "Aaron Judge": 0.58,
      "Juan Soto": 0.57,
    });

    const pool = await runCoachScan({
      slate,
      registry,
      sim,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
    });

    assert.equal(pool.manifest.gatesPassed, 2);
    assert.equal(pool.props.length, 2);
    assert.ok(pool.props.every((p) => p.grade.length >= 1));
    assert.ok(pool.props.every((p) => p.gateEvaluation.allPassed));
    assert.ok(pool.manifest.rejectionBreakdown.ev_not_positive == null);
  });

  it("evaluates every candidate even after finding qualified legs", async () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const registry = createDefaultSportRegistry();
    let simCalls = 0;
    const sim = new CoachSimService({
      store: new InMemorySimCacheStore(),
      executePropSim: async ({ props }) => {
        simCalls += 1;
        return {
          props: [
            {
              simulations: 10_000,
              hitProbability: 0.58,
              confidenceScore: 60,
            },
          ],
        };
      },
    });

    await runCoachScan({
      slate,
      registry,
      sim,
      sportContext,
      resolveGateContext: () => passingGateContext,
      sports: ["mlb"],
    });

    assert.equal(simCalls, 2);
  });

  it("game lines fail simulation gate until game-line sim ships", async () => {
    const slate = normalizeCoachSlate(rawSlate, { nowMs: NOW });
    const registry = createDefaultSportRegistry();
    const sim = createSimService({ "Aaron Judge": 0.58 });

    const pool = await runCoachScan({
      slate,
      registry,
      sim,
      sportContext,
      resolveGateContext: () => passingGateContext,
    });

    assert.equal(pool.gameLines.length, 0);
    assert.ok((pool.manifest.rejectionBreakdown.sim_incomplete ?? 0) >= 1);
  });
});
