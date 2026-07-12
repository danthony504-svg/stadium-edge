import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CoachGateResult,
  CoachSportAdapter,
  CoachSportEnumerateInput,
  CoachSportRegistry,
} from "../src/index";
import { COACH_GATE_IDS } from "../src/index";

function passingGate(gateId: (typeof COACH_GATE_IDS)[number]): CoachGateResult {
  return {
    gateId,
    pass: true,
    reasonCode: "passed",
    message: "ok",
  };
}

function createStubMlbAdapter(): CoachSportAdapter {
  return {
    sportId: "mlb",
    displayName: "MLB",
    supportedGameMarkets: () => [
      {
        kind: "moneyline",
        marketKey: "h2h",
        displayLabel: "Moneyline",
        supportsAlts: false,
        simModel: "inning",
      },
    ],
    supportedPropMarkets: () => [
      {
        kind: "player_stat",
        marketKey: "player_hits",
        displayLabel: "Player Hits",
        supportsAlts: true,
        simModel: "inning",
      },
    ],
    enumerateCandidates: (input: CoachSportEnumerateInput) => {
      const legs = [];
      for (const prop of input.props) {
        legs.push({
          legId: `${prop.gameId}:${prop.marketKey}:${prop.playerId}:${prop.side}`,
          legFingerprint: `fp:${prop.gameId}:${prop.marketKey}:${prop.line}:${prop.odds}`,
          kind: "player_prop" as const,
          sport: "mlb" as const,
          gameId: prop.gameId,
          gameLabel: prop.gameLabel,
          marketKey: prop.marketKey,
          marketLabel: prop.marketLabel,
          pick: prop.pick,
          odds: prop.odds,
          line: prop.line,
          startsAt: prop.startsAt,
          isAlt: prop.isAlt,
          playerId: prop.playerId,
          playerName: prop.playerName,
          propSide: prop.side,
        });
      }
      return legs;
    },
    evaluateSportSpecific: () => passingGate("sport_specific"),
  };
}

function createRegistry(): CoachSportRegistry {
  const adapters = new Map<string, CoachSportAdapter>();
  return {
    register(adapter) {
      adapters.set(adapter.sportId, adapter);
    },
    get(sportId) {
      return adapters.get(sportId);
    },
    has(sportId) {
      return adapters.has(sportId);
    },
    all() {
      return [...adapters.values()];
    },
    sportIds() {
      return [...adapters.keys()];
    },
  };
}

describe("coach sport adapter contract", () => {
  it("registry resolves adapter by sport id", () => {
    const registry = createRegistry();
    const mlb = createStubMlbAdapter();
    registry.register(mlb);
    assert.equal(registry.get("mlb")?.sportId, "mlb");
    assert.equal(registry.has("nba"), false);
  });

  it("adapter enumerates all props without stopping early", () => {
    const adapter = createStubMlbAdapter();
    const input: CoachSportEnumerateInput = {
      sport: "mlb",
      gameLines: [],
      props: [
        {
          gameId: "g1",
          gameLabel: "A @ B",
          marketKey: "player_hits",
          marketLabel: "Hits",
          playerId: "p1",
          playerName: "Player One",
          pick: "Over 1.5",
          odds: -110,
          line: 1.5,
          side: "Over",
          startsAt: "2026-07-12T23:00:00.000Z",
          isAlt: false,
        },
        {
          gameId: "g1",
          gameLabel: "A @ B",
          marketKey: "player_hits",
          marketLabel: "Hits",
          playerId: "p1",
          playerName: "Player One",
          pick: "Over 2.5",
          odds: 140,
          line: 2.5,
          side: "Over",
          startsAt: "2026-07-12T23:00:00.000Z",
          isAlt: true,
        },
      ],
    };
    const candidates = adapter.enumerateCandidates(input);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[1]?.isAlt, true);
  });

  it("adapter exposes game and prop market definitions", () => {
    const adapter = createStubMlbAdapter();
    assert.ok(adapter.supportedGameMarkets().length >= 1);
    assert.ok(adapter.supportedPropMarkets().length >= 1);
  });

  it("new sport can register without modifying core types", () => {
    const registry = createRegistry();
    registry.register({
      sportId: "custom_sport_x",
      displayName: "Custom Sport",
      supportedGameMarkets: () => [],
      supportedPropMarkets: () => [],
      enumerateCandidates: () => [],
      evaluateSportSpecific: () => passingGate("sport_specific"),
    });
    assert.equal(registry.sportIds().includes("custom_sport_x"), true);
  });
});
